// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

const maxReadBytes = 10000

var diagramNameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9_\-]+`)

// buildCodebaseRegistry registers list_directory, read_file (confined to
// rootDir), and generate_diagram directly onto a livebridge.FuncRegistry.
func buildCodebaseRegistry(rootDir, diagramsDir string) (*livebridge.FuncRegistry, error) {
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, err
	}
	reg := livebridge.NewFuncRegistry()

	reg.Register(&genai.FunctionDeclaration{
		Name:        "list_directory",
		Description: "List files and folders in a workspace directory relative to the project root.",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"path": {Type: genai.TypeString, Description: "Relative path inside the workspace (default '.')."},
			},
		},
	}, func(_ context.Context, args map[string]any) (map[string]any, error) {
		rel, _ := args["path"].(string)
		if strings.TrimSpace(rel) == "" {
			rel = "."
		}
		target, err := confineToRoot(absRoot, rel)
		if err != nil {
			return nil, err
		}
		entries, err := os.ReadDir(target)
		if err != nil {
			return nil, fmt.Errorf("reading directory %q: %w", rel, err)
		}
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() {
				name += "/"
			}
			names = append(names, name)
		}
		return map[string]any{
			"title":   "Directory: " + rel,
			"summary": fmt.Sprintf("%d entries", len(names)),
			"path":    rel,
			"entries": names,
		}, nil
	})

	reg.Register(&genai.FunctionDeclaration{
		Name:        "read_file",
		Description: "Read a UTF-8 file inside the workspace (capped at 10 KB).",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"path": {Type: genai.TypeString, Description: "Relative path of the file to read."},
			},
			Required: []string{"path"},
		},
	}, func(_ context.Context, args map[string]any) (map[string]any, error) {
		rel, _ := args["path"].(string)
		if strings.TrimSpace(rel) == "" {
			return nil, errors.New("path is required")
		}
		target, err := confineToRoot(absRoot, rel)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(target)
		if err != nil {
			return nil, fmt.Errorf("reading file %q: %w", rel, err)
		}
		content := string(data)
		truncated := false
		if len(content) > maxReadBytes {
			content = livebridge.TruncateRunes(content, maxReadBytes) + "\n...[truncated]"
			truncated = true
		}
		return map[string]any{
			"title":     "Read: " + rel,
			"summary":   fmt.Sprintf("%d bytes", len(data)),
			"path":      rel,
			"content":   content,
			"truncated": truncated,
		}, nil
	})

	reg.Register(&genai.FunctionDeclaration{
		Name:        "generate_diagram",
		Description: "Render a Graphviz DOT architecture or sequence diagram to PNG.",
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"dot_code": {Type: genai.TypeString, Description: "Valid Graphviz DOT syntax."},
				"title":    {Type: genai.TypeString, Description: "Diagram caption."},
				"filename": {Type: genai.TypeString, Description: "Optional base filename."},
			},
			Required: []string{"dot_code"},
		},
	}, func(ctx context.Context, args map[string]any) (map[string]any, error) {
		dotCode, _ := args["dot_code"].(string)
		if strings.TrimSpace(dotCode) == "" {
			return nil, errors.New("dot_code is required")
		}
		title, _ := args["title"].(string)
		if title == "" {
			title = "Architecture Diagram"
		}
		rawName, _ := args["filename"].(string)
		clean := strings.Trim(diagramNameSanitizer.ReplaceAllString(rawName, "_"), "_")
		if clean == "" {
			clean = fmt.Sprintf("diagram_%d", time.Now().UnixNano())
		}
		if err := os.MkdirAll(diagramsDir, 0o755); err != nil {
			return nil, err
		}
		dotPath := filepath.Join(diagramsDir, clean+".dot")
		pngPath := filepath.Join(diagramsDir, clean+".png")
		if err := os.WriteFile(dotPath, []byte(dotCode), 0o644); err != nil {
			return nil, err
		}
		dotBin, err := exec.LookPath("dot")
		if err != nil {
			return map[string]any{
				"title":    title,
				"summary":  "Saved DOT source (install graphviz for PNG rendering)",
				"dot_code": dotCode,
			}, nil
		}
		out, err := exec.CommandContext(ctx, dotBin, "-Tpng", dotPath, "-o", pngPath).CombinedOutput()
		if err != nil {
			return map[string]any{
				"error":    fmt.Sprintf("graphviz failed: %s", strings.TrimSpace(string(out))),
				"dot_code": dotCode,
			}, nil
		}
		pngBytes, err := os.ReadFile(pngPath)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"title":        title,
			"summary":      "Rendered Graphviz PNG",
			"dot_code":     dotCode,
			"image_base64": "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes),
		}, nil
	})

	return reg, nil
}

func confineToRoot(absRoot, requested string) (string, error) {
	joined := filepath.Join(absRoot, requested)
	absTarget, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absRoot, absTarget)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q escapes workspace root", requested)
	}
	return absTarget, nil
}
