// ts/avatar-image.ts
var e = {
	width: 704,
	height: 1280
}, t = {
	width: 1280,
	height: 704
};
function n(n, r) {
	return n > r ? t : e;
}
async function r(e, t, r, i = .9) {
	return new Promise((a, o) => {
		let s = new Image();
		s.onload = () => {
			let e = t && r ? {
				width: t,
				height: r
			} : n(s.width, s.height), c = document.createElement("canvas");
			c.width = e.width, c.height = e.height;
			let l = c.getContext("2d");
			if (!l) {
				o(/* @__PURE__ */ Error("Failed to get 2D canvas context"));
				return;
			}
			let u = s.width / s.height, d = e.width / e.height, f = s.width, p = s.height, m = 0, h = 0;
			u > d ? (f = s.height * d, m = (s.width - f) / 2) : (p = s.width / d, h = (s.height - p) / 2), l.drawImage(s, m, h, f, p, 0, 0, e.width, e.height), a(c.toDataURL("image/jpeg", i));
		}, s.onerror = () => o(/* @__PURE__ */ Error("Failed to load avatar image")), s.src = e;
	});
}
var i = r;
async function a(e, t = 1024, n = .85) {
	return new Promise((r, i) => {
		let a = new Image();
		a.onload = () => {
			let o = a.width, s = a.height;
			if (o <= t && s <= t) {
				r(e);
				return;
			}
			o > s ? (s = Math.round(s * t / o), o = t) : (o = Math.round(o * t / s), s = t);
			let c = document.createElement("canvas");
			c.width = o, c.height = s;
			let l = c.getContext("2d");
			l ? (l.drawImage(a, 0, 0, o, s), r(c.toDataURL("image/jpeg", n))) : i(/* @__PURE__ */ Error("Failed to get 2D canvas context"));
		}, a.onerror = () => i(/* @__PURE__ */ Error("Failed to load image for resize")), a.src = e;
	});
}
// ts/chime-synth.ts
var o = {
	soft: {
		cutoffHz: 780,
		peakGain: .032,
		durationSec: .85,
		includeUpperFourth: !0
	},
	subtle: {
		cutoffHz: 620,
		peakGain: .014,
		durationSec: .55,
		includeUpperFourth: !1
	}
};
function s(e, t = "soft") {
	let n = (e ?? "").trim().toLowerCase();
	return n === "soft" || n === "subtle" || n === "off" ? n : t;
}
var c = class {
	constructor(e = "soft") {
		this.mode = e;
	}
	setMode(e) {
		this.mode = e;
	}
	cycleMode() {
		let e = [
			"soft",
			"subtle",
			"off"
		], t = e.indexOf(this.mode);
		return this.mode = e[(t + 1) % e.length], this.mode;
	}
	playAmbientCue(e) {
		if (this.mode === "off") return 0;
		let t = o[this.mode], n = e.currentTime, r = e.createBiquadFilter();
		r.type = "lowpass", r.frequency.setValueAtTime(t.cutoffHz, n), r.Q.setValueAtTime(.7, n);
		let i = e.createGain();
		i.gain.setValueAtTime(1e-4, n), i.gain.exponentialRampToValueAtTime(t.peakGain, n + .06), i.gain.exponentialRampToValueAtTime(1e-4, n + t.durationSec);
		let a = e.createOscillator();
		a.type = "sine", a.frequency.setValueAtTime(392, n), a.connect(r);
		let s = null;
		if (t.includeUpperFourth) {
			s = e.createOscillator();
			let t = e.createGain();
			s.type = "sine", s.frequency.setValueAtTime(523.25, n), t.gain.setValueAtTime(.45, n), s.connect(t), t.connect(r);
		}
		return r.connect(i), i.connect(e.destination), a.start(n), a.stop(n + t.durationSec + .05), s && (s.start(n + .03), s.stop(n + t.durationSec + .05)), t.durationSec;
	}
	playTurnTone(e) {
		if (this.mode === "off") return 0;
		let t = e.currentTime, n = e.createOscillator(), r = e.createBiquadFilter(), i = e.createGain();
		n.type = "sine", n.frequency.setValueAtTime(392, t), r.type = "lowpass", r.frequency.setValueAtTime(680, t);
		let a = this.mode === "subtle" ? .01 : .02;
		return i.gain.setValueAtTime(1e-4, t), i.gain.exponentialRampToValueAtTime(a, t + .05), i.gain.exponentialRampToValueAtTime(1e-4, t + .4), n.connect(r), r.connect(i), i.connect(e.destination), n.start(t), n.stop(t + .45), .4;
	}
}, l = class {
	constructor(e = {}) {
		this.hasReceivedVideo = !1, this.configuredCodec = "avc1.42C020, mp4a.40.2", this.videoEl = null, this.mediaSource = null, this.sourceBuffer = null, this.bufferQueue = [], this.objectUrl = null, this.pendingTrimFuture = !1, this.handleSourceOpen = () => {
			this.initSourceBuffer();
		}, this.handleSourceError = (e) => {
			console.error("MediaSource error:", e);
		}, this.handleSourceBufferUpdateEnd = () => {
			this.onSourceBufferUpdateEnd();
		}, this.handleSourceBufferError = (e) => {
			console.error("SourceBuffer error:", e);
		}, this.handleVideoError = () => {
			this.videoEl?.error && console.error("HTMLVideoElement error:", this.videoEl.error);
		}, this.callbacks = e;
	}
	attach(e) {
		this.destroy(), this.videoEl = e, this.videoEl.addEventListener("error", this.handleVideoError), this.mediaSource = new MediaSource(), this.mediaSource.addEventListener("sourceopen", this.handleSourceOpen), this.mediaSource.addEventListener("error", this.handleSourceError), this.objectUrl = URL.createObjectURL(this.mediaSource), this.videoEl.src = this.objectUrl;
	}
	setCodec(e) {
		if (e && e !== this.configuredCodec && (this.configuredCodec = e, this.sourceBuffer && typeof this.sourceBuffer.changeType == "function")) {
			let t = `video/mp4; codecs="${e}"`;
			if (MediaSource.isTypeSupported(t)) try {
				this.sourceBuffer.changeType(t);
			} catch (e) {
				console.warn("SourceBuffer.changeType failed:", e);
			}
		}
	}
	appendChunk(e) {
		this.bufferQueue.push(e), this.hasReceivedVideo || (this.hasReceivedVideo = !0, this.callbacks.onFirstChunk?.()), this.processBufferQueue();
	}
	flushAndAbort() {
		if (this.bufferQueue = [], this.pendingTrimFuture = !1, this.sourceBuffer) {
			if (this.sourceBuffer.updating) try {
				this.sourceBuffer.abort();
			} catch (e) {
				console.error("Failed to abort SourceBuffer", e);
			}
			this.sourceBuffer.updating ? this.pendingTrimFuture = !0 : this.trimFutureBufferedMedia();
		}
	}
	destroy() {
		this.bufferQueue = [], this.pendingTrimFuture = !1, this.hasReceivedVideo = !1, this.sourceBuffer &&= (this.sourceBuffer.removeEventListener("updateend", this.handleSourceBufferUpdateEnd), this.sourceBuffer.removeEventListener("error", this.handleSourceBufferError), null), this.mediaSource &&= (this.mediaSource.removeEventListener("sourceopen", this.handleSourceOpen), this.mediaSource.removeEventListener("error", this.handleSourceError), null), this.videoEl &&= (this.videoEl.removeEventListener("error", this.handleVideoError), this.videoEl.removeAttribute("src"), this.videoEl.load(), null), this.objectUrl &&= (URL.revokeObjectURL(this.objectUrl), null);
	}
	trimFutureBufferedMedia() {
		if (this.sourceBuffer && !this.sourceBuffer.updating && this.mediaSource && this.mediaSource.readyState === "open") try {
			let e = this.sourceBuffer.buffered;
			if (e.length === 0) return;
			let t = this.videoEl ? this.videoEl.currentTime : 0;
			e.end(e.length - 1) > t + .05 && this.sourceBuffer.remove(Math.max(0, t), Infinity);
		} catch (e) {
			console.warn("Failed to trim future SourceBuffer range:", e);
		}
	}
	evictOldBufferedMedia() {
		if (!this.sourceBuffer || this.sourceBuffer.updating || !this.mediaSource || this.mediaSource.readyState !== "open") return !1;
		try {
			let e = this.sourceBuffer.buffered;
			if (e.length === 0) return !1;
			let t = e.start(0), n = this.videoEl ? this.videoEl.currentTime : 0, r = Math.max(t + 1, n - 5);
			if (r > t && r <= e.end(e.length - 1)) return this.sourceBuffer.remove(t, r), !0;
		} catch (e) {
			console.warn("Failed to evict old SourceBuffer range:", e);
		}
		return !1;
	}
	initSourceBuffer() {
		if (!this.mediaSource || this.mediaSource.readyState !== "open" || this.sourceBuffer) return;
		let e = `video/mp4; codecs="${this.configuredCodec}"`, t = "video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"", n = e;
		if (MediaSource.isTypeSupported(n) || (console.warn(`MIME type ${n} not supported, falling back to ${t}`), n = t), MediaSource.isTypeSupported(n)) try {
			this.sourceBuffer = this.mediaSource.addSourceBuffer(n);
		} catch (e) {
			console.error("Failed to create SourceBuffer with target codec", e);
			try {
				this.sourceBuffer = this.mediaSource.addSourceBuffer("video/mp4");
			} catch (e) {
				console.error("All SourceBuffer attempts failed", e);
			}
		}
		else console.error("Browser does not support fMP4 video playback");
		this.sourceBuffer && (this.sourceBuffer.addEventListener("updateend", this.handleSourceBufferUpdateEnd), this.sourceBuffer.addEventListener("error", this.handleSourceBufferError), this.processBufferQueue());
	}
	onSourceBufferUpdateEnd() {
		if (!(this.pendingTrimFuture && (this.pendingTrimFuture = !1, this.trimFutureBufferedMedia(), this.sourceBuffer?.updating)) && (this.processBufferQueue(), this.sourceBuffer && this.videoEl && this.sourceBuffer.buffered.length > 0)) {
			let e = this.sourceBuffer.buffered.length, t = this.sourceBuffer.buffered.start(e - 1);
			(this.videoEl.currentTime < t - .1 || e > 1 && this.videoEl.currentTime < t) && (this.videoEl.currentTime = t), this.videoEl.paused && this.bufferQueue.length === 0 && this.videoEl.play().catch((e) => console.warn("Autoplay wait on updateend:", e));
		}
	}
	processBufferQueue() {
		if (this.sourceBuffer && !this.sourceBuffer.updating && this.bufferQueue.length > 0) {
			let e = this.bufferQueue.shift();
			try {
				this.sourceBuffer.appendBuffer(e), this.videoEl && this.videoEl.paused && this.videoEl.play().catch((e) => console.warn("Autoplay wait:", e));
			} catch (t) {
				t instanceof DOMException && t.name === "QuotaExceededError" ? (this.bufferQueue.unshift(e), this.evictOldBufferedMedia() || this.bufferQueue.shift()) : console.error("Error appending video buffer:", t);
			}
		}
	}
};
// ts/transcript-assembler.ts
function u(e) {
	let t = typeof e.name == "string" ? e.name : "tool", n = typeof e.id == "string" ? e.id : void 0, r = e.args && typeof e.args == "object" ? e.args : {}, i = e.result && typeof e.result == "object" && !Array.isArray(e.result) ? e.result : void 0, a = typeof r.title == "string" && r.title.trim() ? r.title.trim() : t, o = typeof r.summary == "string" && r.summary.trim() ? r.summary.trim() : JSON.stringify(r), s = typeof r.category == "string" && r.category.trim() ? r.category.trim() : void 0, c = Array.isArray(r.items) ? r.items.filter((e) => typeof e == "string" && e.trim() !== "").map((e) => e.trim()) : void 0;
	return {
		type: "tool",
		text: `${a}: ${o}`,
		toolCard: {
			id: n,
			name: t,
			title: a,
			summary: o,
			category: s,
			items: c,
			result: i
		}
	};
}
var d = class {
	constructor() {
		this.entries = [];
	}
	reset() {
		return this.entries = [], this.entries;
	}
	addUserText(e) {
		return this.entries = [...this.entries, {
			type: "user",
			text: e
		}], this.entries;
	}
	appendTurn(e, t, n, r) {
		let i = this.entries.length - 1;
		if (i >= 0 && this.entries[i].type === e && this.entries[i].isPartial) {
			let a = [...this.entries];
			a[i] = {
				type: e,
				text: r ? a[i].text + t : t,
				isPartial: !n
			}, this.entries = a;
		} else this.entries = [...this.entries, {
			type: e,
			text: t,
			isPartial: !n
		}];
		return this.entries;
	}
	addToolCall(e) {
		return this.entries = [...this.entries, u(e)], this.entries;
	}
	cancelToolCalls(e) {
		let t = new Set(e);
		return this.entries = this.entries.map((e) => e.type === "tool" && e.toolCard?.id && t.has(e.toolCard.id) ? {
			...e,
			toolCard: {
				...e.toolCard,
				cancelled: !0
			}
		} : e), this.entries;
	}
	markToolCallsCancelled(e) {
		return this.cancelToolCalls(e);
	}
	markInterrupted() {
		if (this.entries.length === 0) return !1;
		let e = this.entries[this.entries.length - 1];
		if (e.type !== "assistant" || !e.isPartial) return !1;
		let t = [...this.entries];
		return t[t.length - 1] = {
			type: "assistant",
			text: e.text + " —",
			isPartial: !1
		}, this.entries = t, !0;
	}
	interruptPartialAssistantTurn() {
		return this.markInterrupted();
	}
	sealActiveTurns() {
		let e = !1, t = this.entries.map((t) => t.isPartial ? (e = !0, {
			...t,
			isPartial: !1
		}) : t);
		return e && (this.entries = t), e;
	}
	finalizeAssistantTurn() {
		return this.sealActiveTurns();
	}
};
// ts/live-socket.ts
function f(e, t, n) {
	let r = t?.trim() || "";
	return n.limitReachedAlreadySurfaced || r === "Session limit reached" ? n.limitReachedAlreadySurfaced ? null : {
		kind: "limit",
		message: "10-minute session limit reached."
	} : e === 1007 ? {
		kind: "invalid_config",
		message: r || "Invalid session configuration."
	} : e === 1009 ? {
		kind: "too_large",
		message: r || "Message too large — session disconnected."
	} : !n.isTerminating && (e !== 1e3 || n.hadErrorEvent) ? {
		kind: "abnormal",
		message: r ? `Session closed: ${r}` : "Connection to Gemini Live failed or was lost."
	} : null;
}
function p(e) {
	let t = atob(e), n = new Uint8Array(t.length);
	for (let e = 0; e < t.length; e++) n[e] = t.charCodeAt(e);
	return n.buffer;
}
var m = class {
	constructor() {
		this.status = "Idle", this.isTerminating = !1, this.sessionMode = "", this.sessionModel = "", this.sessionLocation = "", this.transcriptAssembler = new d(), this.ws = null, this.options = null, this.terminateTimeoutId = null, this.hasNotifiedDisconnect = !1, this.limitReached = !1, this.hadErrorEvent = !1, this.upstreamReady = !1;
	}
	get isConnected() {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}
	get transcript() {
		return this.transcriptAssembler.entries;
	}
	connect(e) {
		this.cleanup(), this.options = e, this.status = "Connecting...", this.transcriptAssembler.reset(), this.isTerminating = !1, this.sessionMode = "", this.sessionModel = "", this.sessionLocation = "", this.hasNotifiedDisconnect = !1, this.limitReached = !1, this.hadErrorEvent = !1, this.upstreamReady = e.gateRealtimeMediaOnReady === !1, this.options.onStateChange?.();
		let t = e.url ?? this.resolveEndpointUrl(e.endpoint), n = new WebSocket(t);
		n.binaryType = "arraybuffer", this.ws = n, n.onopen = () => {
			this.ws === n && (this.status = "Connected", this.options?.onStateChange?.(), e.initialPayload !== void 0 && n.send(JSON.stringify(e.initialPayload)));
		}, n.onmessage = (t) => {
			if (this.ws === n) {
				if (this.upstreamReady = !0, t.data instanceof ArrayBuffer) e.onBinaryFrame?.(t.data);
				else try {
					let e = JSON.parse(t.data);
					this.handleJsonMessage(e);
				} catch (e) {
					console.error("Error parsing WebSocket message JSON", e);
				}
			}
		}, n.onerror = (e) => {
			this.ws === n && (console.error("WebSocket Error:", e), this.hadErrorEvent = !0, this.status = "Error connecting", this.options?.onStateChange?.());
		}, n.onclose = (e) => {
			if (this.ws !== n) return;
			this.status = "Disconnected";
			let t = f(e.code, e.reason, {
				limitReachedAlreadySurfaced: this.limitReached,
				isTerminating: this.isTerminating,
				hadErrorEvent: this.hadErrorEvent
			});
			this.cleanup(), t && this.options?.onWarning?.(t.message), this.options?.onStateChange?.(), this.notifyDisconnect();
		};
	}
	sendPayload(e) {
		this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify(e));
	}
	sendAudioChunk(e) {
		this.upstreamReady && this.sendPayload({
			type: "audio",
			mimeType: "audio/pcm;rate=16000",
			data: e
		});
	}
	sendVideoFrame(e, t = "image/jpeg") {
		this.upstreamReady && this.sendPayload({
			type: "video",
			mimeType: t,
			data: e
		});
	}
	sendText(e) {
		let t = e.trim();
		return !t || !this.ws || this.ws.readyState !== WebSocket.OPEN ? !1 : (this.sendPayload({
			type: "text",
			data: t
		}), this.transcriptAssembler.addUserText(t), this.options?.onStateChange?.(), !0);
	}
	sendToolResult(e, t, n, r) {
		this.sendPayload({
			type: "tool_result",
			id: e,
			name: t,
			result: n,
			...r?.imageDataUrl ? { image: r.imageDataUrl } : {},
			...r?.execMs === void 0 ? {} : { execMs: r.execMs }
		});
	}
	terminate() {
		if (this.isTerminating) return;
		this.isTerminating = !0, this.status = "Disconnecting...", this.options?.onStateChange?.(), this.options?.onBeforeTerminate?.();
		let e = this.options?.terminateTimeoutMs ?? 15e3;
		this.ws && this.ws.readyState === WebSocket.OPEN ? (this.ws.send(JSON.stringify({
			type: "control",
			action: "terminate"
		})), this.terminateTimeoutId = setTimeout(() => {
			this.terminateTimeoutId = null, this.status = "Disconnected", this.cleanup(), this.options?.onStateChange?.(), this.notifyDisconnect();
		}, e)) : (this.status = "Disconnected", this.cleanup(), this.options?.onStateChange?.(), this.notifyDisconnect());
	}
	requestGracefulTermination() {
		this.terminate();
	}
	disconnect() {
		this.status = "Disconnected", this.cleanup(), this.options?.onStateChange?.(), this.notifyDisconnect();
	}
	cleanup() {
		if (this.terminateTimeoutId !== null && (clearTimeout(this.terminateTimeoutId), this.terminateTimeoutId = null), this.isTerminating = !1, this.upstreamReady = !1, this.options?.onBeforeTerminate?.(), this.ws) {
			let e = this.ws;
			this.ws = null, (e.readyState === WebSocket.OPEN || e.readyState === WebSocket.CONNECTING) && e.close();
		}
	}
	resolveEndpointUrl(e = "/ws") {
		return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${e}`;
	}
	handleJsonMessage(e) {
		let t = e.type;
		if (t === "session_info") typeof e.mode == "string" && e.mode && (this.sessionMode = e.mode), typeof e.model == "string" && e.model && (this.sessionModel = e.model), typeof e.location == "string" && e.location && (this.sessionLocation = e.location), this.options?.onStateChange?.();
		else if (t === "media_config" || t === "audio_config") this.options?.onMediaConfig?.(e);
		else if (t === "audio" && typeof e.data == "string") this.options?.onBinaryFrame?.(p(e.data));
		else if (t === "transcript" || t === "output_transcript") {
			let n = e.finished === !0 || e.finished === "true" || t === "transcript", r = typeof e.text == "string" ? e.text : "";
			this.transcriptAssembler.appendTurn("assistant", r, n, !0), this.options?.onStateChange?.();
		} else if (t === "input_transcript") {
			let t = e.finished === !0 || e.finished === "true", n = typeof e.text == "string" ? e.text : "";
			this.transcriptAssembler.appendTurn("user", n, t, !1), this.options?.onStateChange?.();
		} else if (t === "tool_call" || t === "tool_execution") this.transcriptAssembler.addToolCall(e), this.options?.onToolCall?.(e), this.options?.onStateChange?.();
		else if (t === "tool_call_cancellation" && Array.isArray(e.ids)) {
			let t = e.ids.filter((e) => typeof e == "string");
			this.transcriptAssembler.cancelToolCalls(t), this.options?.onToolCallCancellation?.(t, e), this.options?.onStateChange?.();
		} else t === "interrupted" ? (this.options?.onInterrupted?.(), this.transcriptAssembler.markInterrupted() && this.options?.onStateChange?.()) : t === "turn_complete" ? (this.transcriptAssembler.sealActiveTurns() && this.options?.onStateChange?.(), this.options?.onTurnComplete?.()) : t === "proactive_alert" ? this.options?.onProactiveAlert?.(e) : t === "status" && (e.error === "session_limit_reached" || e.message === "session_limit_reached") ? (this.limitReached = !0, this.status = "10m Session Limit Reached", this.options?.onWarning?.("10-minute session limit reached."), this.options?.onStateChange?.()) : this.options?.onCustomMessage?.(e);
	}
	notifyDisconnect() {
		this.hasNotifiedDisconnect || (this.hasNotifiedDisconnect = !0, this.options?.onDisconnected?.());
	}
};
// ts/pcm-mic.ts
async function h() {
	let e = new AudioContext({ sampleRate: 16e3 }), t = URL.createObjectURL(new Blob(["\n      class PcmProcessor extends AudioWorkletProcessor {\n        constructor() {\n          super();\n          this.bufferSize = 2048;\n          this.buffer = new Int16Array(this.bufferSize);\n          this.offset = 0;\n        }\n\n        process(inputs) {\n          const input = inputs[0];\n          if (input && input.length > 0) {\n            const channel = input[0];\n            for (let i = 0; i < channel.length; i++) {\n              const s = Math.max(-1, Math.min(1, channel[i]));\n              this.buffer[this.offset] = s < 0 ? s * 0x8000 : s * 0x7FFF;\n              this.offset++;\n\n              if (this.offset >= this.bufferSize) {\n                this.port.postMessage(this.buffer);\n                this.offset = 0;\n              }\n            }\n          }\n          return true;\n        }\n      }\n      registerProcessor('pcm-processor', PcmProcessor);\n    "], { type: "application/javascript" }));
	try {
		await e.audioWorklet.addModule(t);
	} catch (t) {
		throw e.close().catch(() => {}), t;
	} finally {
		URL.revokeObjectURL(t);
	}
	return e;
}
function g(e) {
	let t = /* @__PURE__ */ new ArrayBuffer(e.length * 2), n = new DataView(t);
	for (let t = 0; t < e.length; t++) n.setInt16(t * 2, e[t], !0);
	return new Uint8Array(t);
}
function _(e) {
	let t = "", n = e.byteLength;
	for (let r = 0; r < n; r++) t += String.fromCharCode(e[r]);
	return btoa(t);
}
function v(e) {
	if (e.length === 0) return 0;
	let t = 0;
	for (let n = 0; n < e.length; n++) {
		let r = e[n] / 32768;
		t += r * r;
	}
	return Math.min(1, Math.sqrt(t / e.length));
}
var y = class {
	constructor(e = {}) {
		this.isRecording = !1, this.isSoftMuted = !1, this.audioContext = null, this.audioWorkletNode = null, this.mediaStream = null, this.startToken = 0, this.callbacks = e;
	}
	setSoftMuted(e) {
		this.isSoftMuted = e;
	}
	async toggle(e) {
		this.isRecording ? this.stop() : await this.start(e);
	}
	async start(e) {
		let t = ++this.startToken;
		try {
			let n = await navigator.mediaDevices.getUserMedia({ audio: {
				channelCount: 1,
				sampleRate: 16e3
			} });
			if (t !== this.startToken) {
				n.getTracks().forEach((e) => e.stop());
				return;
			}
			if (this.mediaStream && this.mediaStream.getTracks().forEach((e) => e.stop()), this.mediaStream = n, !this.audioContext) {
				let e = await h();
				if (t !== this.startToken) {
					e.close().catch(() => {}), this.stop();
					return;
				}
				this.audioContext = e;
			}
			if (this.audioContext.state === "suspended" && (await this.audioContext.resume(), t !== this.startToken || !this.audioContext)) {
				this.stop();
				return;
			}
			let r = this.audioContext.createMediaStreamSource(this.mediaStream);
			this.audioWorkletNode = new AudioWorkletNode(this.audioContext, "pcm-processor"), this.audioWorkletNode.port.onmessage = (t) => {
				if (this.isSoftMuted) {
					this.callbacks.onRmsLevel?.(0);
					return;
				}
				let n = t.data;
				this.callbacks.onRmsLevel?.(v(n)), e(_(g(n)));
			}, r.connect(this.audioWorkletNode), this.isRecording = !0, this.callbacks.onStateChange?.(!0);
		} catch (e) {
			this.stop(), this.callbacks.onError?.(e);
		}
	}
	stop() {
		this.startToken++, this.audioWorkletNode &&= (this.audioWorkletNode.port.onmessage = null, this.audioWorkletNode.disconnect(), null), this.mediaStream &&= (this.mediaStream.getTracks().forEach((e) => e.stop()), null), this.audioContext &&= (this.audioContext.close().catch(() => {}), null), this.isRecording && (this.isRecording = !1, this.callbacks.onStateChange?.(!1));
	}
}, b = class {
	constructor(e = {}) {
		this.hasReceivedAudio = !1, this.isMuted = !1, this.sampleRate = 24e3, this.audioContext = null, this.analyserNode = null, this.outputGainNode = null, this.audioQueue = [], this.activeSources = /* @__PURE__ */ new Set(), this.nextPlayTime = 0, this.callbacks = e;
	}
	get analyser() {
		return this.analyserNode;
	}
	get context() {
		return this.audioContext;
	}
	get isPlaying() {
		return this.activeSources.size > 0;
	}
	init(e = 24e3) {
		if (this.audioContext && this.sampleRate === e) {
			this.audioContext.state === "suspended" && this.audioContext.resume().catch(() => {});
			return;
		}
		this.destroyContext(), this.sampleRate = e > 0 ? e : 24e3;
		let t = window.AudioContext || window.webkitAudioContext;
		this.audioContext = new t({ sampleRate: this.sampleRate }), this.analyserNode = this.audioContext.createAnalyser(), this.analyserNode.fftSize = 256, this.analyserNode.smoothingTimeConstant = .8, this.outputGainNode = this.audioContext.createGain(), this.outputGainNode.gain.value = +!this.isMuted, this.analyserNode.connect(this.outputGainNode), this.outputGainNode.connect(this.audioContext.destination), this.callbacks.onStateChange?.();
	}
	toggleMute() {
		this.setMuted(!this.isMuted);
	}
	setMuted(e) {
		this.isMuted !== e && (this.isMuted = e, this.outputGainNode && (this.outputGainNode.gain.value = +!this.isMuted), this.callbacks.onStateChange?.());
	}
	deferPlayback(e) {
		if (!this.audioContext || e <= 0) return;
		let t = this.audioContext.currentTime + e;
		this.nextPlayTime < t && (this.nextPlayTime = t);
	}
	feed(e) {
		let t = e.byteLength & -2;
		if (t === 0 || (this.audioContext || this.init(this.sampleRate), !this.audioContext || !this.analyserNode)) return;
		this.audioContext.state === "suspended" && this.audioContext.resume().catch(() => {}), this.hasReceivedAudio || (this.hasReceivedAudio = !0, this.callbacks.onStateChange?.());
		let n = t === e.byteLength ? e : e.slice(0, t), r = new Int16Array(n), i = new Float32Array(r.length);
		for (let e = 0; e < r.length; e++) i[e] = r[e] / 32768;
		let a = this.audioContext.createBuffer(1, i.length, this.sampleRate);
		a.getChannelData(0).set(i), this.audioQueue.push(a), this.schedulePlayback();
	}
	flushAndInterrupt() {
		let e = this.activeSources.size > 0;
		this.audioQueue = [];
		for (let e of this.activeSources) try {
			e.stop(), e.disconnect();
		} catch {}
		this.activeSources.clear(), this.nextPlayTime = 0, e && this.callbacks.onPlayingChange?.(!1);
	}
	destroy() {
		this.destroyContext(), this.hasReceivedAudio = !1;
	}
	destroyContext() {
		this.flushAndInterrupt(), this.analyserNode = null, this.outputGainNode = null, this.audioContext && this.audioContext.state !== "closed" && this.audioContext.close().catch(() => {}), this.audioContext = null;
	}
	schedulePlayback() {
		if (!this.audioContext || !this.analyserNode || this.audioQueue.length === 0) return;
		let e = this.activeSources.size === 0, t = this.audioContext.currentTime;
		for (this.nextPlayTime < t && (this.nextPlayTime = t); this.audioQueue.length > 0;) {
			let e = this.audioQueue.shift(), t = this.audioContext.createBufferSource();
			t.buffer = e, t.connect(this.analyserNode), t.onended = () => {
				this.activeSources.delete(t), this.activeSources.size === 0 && this.callbacks.onPlayingChange?.(!1);
			}, this.activeSources.add(t), t.start(this.nextPlayTime), this.nextPlayTime += e.duration;
		}
		e && this.activeSources.size > 0 && this.callbacks.onPlayingChange?.(!0);
	}
}, x = class {
	constructor(e = {}) {
		this.isCameraActive = !1, this.isScreenShareActive = !1, this.cameraStream = null, this.cameraIntervalId = null, this.cameraInternalVideo = null, this.screenStream = null, this.screenIntervalId = null, this.screenInternalVideo = null, this.cameraToken = 0, this.screenToken = 0, this.callbacks = e;
	}
	stopAll() {
		this.stopCamera(), this.stopScreenShare();
	}
	async toggleCamera(e, t) {
		this.isCameraActive ? this.stopCamera() : await this.startCamera(e, t);
	}
	async startCamera(e, t) {
		this.isScreenShareActive && this.stopScreenShare();
		let n = ++this.cameraToken;
		try {
			let r = await navigator.mediaDevices.getUserMedia({ video: {
				width: { ideal: 640 },
				height: { ideal: 480 }
			} });
			if (n !== this.cameraToken) {
				r.getTracks().forEach((e) => e.stop());
				return;
			}
			this.cameraStream && this.cameraStream.getTracks().forEach((e) => e.stop()), this.cameraStream = r, this.isCameraActive = !0, this.callbacks.onStateChange?.();
			let i = await t?.() ?? this.createHeadlessVideoElement("camera");
			if (n !== this.cameraToken || (i.srcObject = this.cameraStream, await i.play().catch(() => {}), n !== this.cameraToken)) {
				this.stopCamera();
				return;
			}
			let a = document.createElement("canvas"), o = a.getContext("2d"), s = this.callbacks.intervalMs ?? 1e3, c = this.callbacks.jpegQuality ?? .7;
			this.cameraIntervalId = setInterval(async () => {
				let n = await t?.() ?? i;
				if (!n || !n.videoWidth || !n.videoHeight) return;
				a.width = n.videoWidth, a.height = n.videoHeight, o?.drawImage(n, 0, 0, a.width, a.height);
				let r = a.toDataURL("image/jpeg", c).split(",")[1];
				r && e(r);
			}, s);
		} catch (e) {
			this.stopCamera(), this.callbacks.onError?.("camera", e);
		}
	}
	stopCamera() {
		this.cameraToken++, this.cameraIntervalId &&= (clearInterval(this.cameraIntervalId), null), this.cameraInternalVideo &&= (this.cameraInternalVideo.srcObject = null, null), this.cameraStream &&= (this.cameraStream.getTracks().forEach((e) => e.stop()), null), this.isCameraActive && (this.isCameraActive = !1, this.callbacks.onStateChange?.());
	}
	async toggleScreenShare(e, t) {
		this.isScreenShareActive ? this.stopScreenShare() : await this.startScreenShare(e, t);
	}
	async startScreenShare(e, t) {
		this.isCameraActive && this.stopCamera();
		let n = ++this.screenToken;
		try {
			let r = await navigator.mediaDevices.getDisplayMedia({
				video: {
					width: { ideal: 1280 },
					height: { ideal: 720 }
				},
				audio: !1
			});
			if (n !== this.screenToken) {
				r.getTracks().forEach((e) => e.stop());
				return;
			}
			this.screenStream && this.screenStream.getTracks().forEach((e) => e.stop()), this.screenStream = r, this.isScreenShareActive = !0, this.callbacks.onStateChange?.();
			let i = this.screenStream.getVideoTracks()[0];
			i && (i.onended = () => {
				this.stopScreenShare();
			});
			let a = await t?.() ?? this.createHeadlessVideoElement("screen");
			if (n !== this.screenToken || (a.srcObject = this.screenStream, await a.play().catch(() => {}), n !== this.screenToken)) {
				this.stopScreenShare();
				return;
			}
			let o = document.createElement("canvas"), s = o.getContext("2d"), c = this.callbacks.intervalMs ?? 1e3, l = this.callbacks.jpegQuality ?? .7, u = this.callbacks.maxScreenDimension ?? 1280;
			this.screenIntervalId = setInterval(async () => {
				let n = await t?.() ?? a;
				if (!n || !n.videoWidth || !n.videoHeight) return;
				let r = n.videoWidth, i = n.videoHeight;
				(r > u || i > u) && (r > i ? (i = Math.round(i * u / r), r = u) : (r = Math.round(r * u / i), i = u)), o.width = r, o.height = i, s?.drawImage(n, 0, 0, r, i);
				let c = o.toDataURL("image/jpeg", l).split(",")[1];
				c && e(c);
			}, c);
		} catch (e) {
			this.stopScreenShare(), this.callbacks.onError?.("screen", e);
		}
	}
	stopScreenShare() {
		this.screenToken++, this.screenIntervalId &&= (clearInterval(this.screenIntervalId), null), this.screenInternalVideo &&= (this.screenInternalVideo.srcObject = null, null), this.screenStream &&= (this.screenStream.getTracks().forEach((e) => {
			e.onended = null, e.stop();
		}), null), this.isScreenShareActive && (this.isScreenShareActive = !1, this.callbacks.onStateChange?.());
	}
	createHeadlessVideoElement(e) {
		let t = document.createElement("video");
		return t.muted = !0, t.playsInline = !0, e === "camera" ? this.cameraInternalVideo = t : this.screenInternalVideo = t, t;
	}
}, S = class extends EventTarget {
	constructor(e = {}) {
		super(), this.micRms = 0, this.lastWarning = "", this.socket = new m(), this.attachedVideoEl = null, this.inFlightPageTools = /* @__PURE__ */ new Map(), this.initOpts = e, this.mode = e.mode ?? "audio", this.chime = new c(e.chimePreset ?? "soft"), this.toolHost = e.toolHost ?? null, this.mic = new y({
			onStateChange: () => {
				this.mic.isRecording || (this.micRms = 0), this.emitChange();
			},
			onRmsLevel: (e) => {
				this.micRms = e, this.initOpts.onRmsLevel?.(e), this.dispatchEvent(new CustomEvent("rms", { detail: e }));
			},
			onError: (e) => {
				this.initOpts.onError?.("mic", e);
			}
		}), this.pcmPlayer = new b({
			onStateChange: () => this.emitChange(),
			onPlayingChange: () => this.emitChange()
		}), this.fmp4Player = new l({ onFirstChunk: () => {
			this.onFirstVideoChunkCb?.(), this.emitChange();
		} }), this.vision = new x({
			intervalMs: e.visionIntervalMs ?? 1e3,
			onStateChange: () => this.emitChange(),
			onError: (e, t) => this.initOpts.onError?.(e, t)
		});
	}
	get status() {
		return this.socket.status;
	}
	get isConnected() {
		return this.socket.isConnected;
	}
	get isTerminating() {
		return this.socket.isTerminating;
	}
	get transcript() {
		return this.socket.transcript;
	}
	get sessionModel() {
		return this.socket.sessionModel;
	}
	get sessionLocation() {
		return this.socket.sessionLocation;
	}
	get isRecording() {
		return this.mic.isRecording;
	}
	get isMuted() {
		return this.mode === "avatar" ? this.attachedVideoEl?.muted ?? !1 : this.pcmPlayer.isMuted;
	}
	get isCameraActive() {
		return this.vision.isCameraActive;
	}
	get isScreenShareActive() {
		return this.vision.isScreenShareActive;
	}
	attachVideoElement(e) {
		this.attachedVideoEl = e, e ? this.fmp4Player.attach(e) : this.fmp4Player.destroy();
	}
	async connect(e = {}) {
		this.abortInFlightTools(), e.mode && (this.mode = e.mode), this.onFirstVideoChunkCb = e.onFirstVideoChunk, e.videoElement !== void 0 && this.attachVideoElement(e.videoElement), this.mode === "audio" && this.pcmPlayer.init(24e3);
		let t = e.initialPayload;
		if (e.advertisePageTools && this.toolHost) {
			let n = await this.toolHost.list();
			t = {
				...e.initialPayload ?? {},
				tools: n
			};
		}
		let n = this.mode === "avatar" ? "/ws" : "/ws/live";
		this.socket.connect({
			url: e.url,
			endpoint: e.endpoint ?? n,
			initialPayload: t,
			terminateTimeoutMs: e.terminateTimeoutMs,
			onMediaConfig: (e) => {
				if (e.mimeType === "video/mp4") this.mode = "avatar", typeof e.codecs == "string" && this.fmp4Player.setCodec(e.codecs);
				else if (typeof e.mimeType == "string" && e.mimeType.startsWith("audio/pcm")) {
					this.mode = "audio";
					let t = typeof e.sampleRate == "number" ? e.sampleRate : 24e3;
					this.pcmPlayer.init(t);
				}
				this.emitChange();
			},
			onBinaryFrame: (e) => {
				this.mode === "avatar" ? this.fmp4Player.appendChunk(new Uint8Array(e)) : this.pcmPlayer.feed(e);
			},
			onToolCall: (t) => {
				e.onToolCall?.(t), this.maybeExecutePageTool(t);
			},
			onToolCallCancellation: (e) => {
				for (let t of e) this.inFlightPageTools.get(t)?.abort(), this.inFlightPageTools.delete(t);
			},
			onInterrupted: () => {
				this.mode === "avatar" ? this.fmp4Player.flushAndAbort() : this.pcmPlayer.flushAndInterrupt();
			},
			onProactiveAlert: (t) => {
				if (this.mode === "audio" && (this.pcmPlayer.init(24e3), this.pcmPlayer.context)) {
					let e = this.chime.playAmbientCue(this.pcmPlayer.context);
					this.pcmPlayer.deferPlayback(e);
				}
				e.onProactiveAlert?.(t), this.dispatchEvent(new CustomEvent("alert", { detail: t })), this.emitChange();
			},
			onCustomMessage: e.onCustomMessage,
			onBeforeTerminate: () => {
				this.mic.stop(), this.vision.stopAll(), this.abortInFlightTools();
			},
			onWarning: (e) => {
				this.lastWarning = e, this.initOpts.onWarning?.(e), this.dispatchEvent(new CustomEvent("warning", { detail: e })), this.emitChange();
			},
			onStateChange: () => {
				(this.socket.sessionMode === "avatar" || this.socket.sessionMode === "audio") && (this.mode = this.socket.sessionMode), this.emitChange();
			},
			onDisconnected: () => {
				this.mic.stop(), this.vision.stopAll(), this.abortInFlightTools(), this.pcmPlayer.destroy(), this.fmp4Player.destroy(), e.onDisconnected?.(), this.dispatchEvent(new Event("disconnect")), this.emitChange();
			}
		}), e.autoStartMic !== !1 && await this.startMic();
	}
	async startMic() {
		await this.mic.start((e) => this.socket.sendAudioChunk(e));
	}
	stopMic() {
		this.mic.stop();
	}
	async toggleMic() {
		await this.mic.toggle((e) => this.socket.sendAudioChunk(e));
	}
	setMuted(e) {
		this.pcmPlayer.setMuted(e), this.attachedVideoEl && (this.attachedVideoEl.muted = e), this.emitChange();
	}
	toggleMute() {
		this.setMuted(!this.isMuted);
	}
	async toggleCamera(e) {
		await this.vision.toggleCamera((e) => this.socket.sendVideoFrame(e), e);
	}
	async toggleScreenShare(e) {
		await this.vision.toggleScreenShare((e) => this.socket.sendVideoFrame(e), e);
	}
	stopVision() {
		this.vision.stopAll();
	}
	sendText(e) {
		return this.socket.sendText(e);
	}
	sendPayload(e) {
		this.socket.sendPayload(e);
	}
	terminate() {
		this.socket.terminate();
	}
	disconnect() {
		this.socket.disconnect();
	}
	async maybeExecutePageTool(e) {
		if (!this.toolHost || e.result !== void 0) return;
		let t = typeof e.id == "string" ? e.id : "", n = typeof e.name == "string" ? e.name : "";
		if (!n || !this.toolHost.isRegistered(n)) return;
		let r = e.args && typeof e.args == "object" && !Array.isArray(e.args) ? e.args : {}, i = new AbortController();
		t && (this.inFlightPageTools.get(t)?.abort(), this.inFlightPageTools.set(t, i));
		let a = performance.now(), o = await this.toolHost.callWithOutput(n, r, i.signal, "live");
		i.signal.aborted || (!t || this.inFlightPageTools.delete(t)) && this.socket.sendToolResult(t, n, o.result, {
			imageDataUrl: o.imageDataUrl,
			execMs: Math.round(performance.now() - a)
		});
	}
	abortInFlightTools() {
		for (let e of this.inFlightPageTools.values()) e.abort();
		this.inFlightPageTools.clear();
	}
	emitChange() {
		this.initOpts.onStateChange?.(), this.dispatchEvent(new Event("change"));
	}
}, C = "https://www.gstatic.com/pantheon/images/aiplatform/vertex_ai_studio/avatars", w = [
	"Ben",
	"Carmen",
	"Ingrid",
	"Jay",
	"Kai",
	"Kira",
	"Leo",
	"Paul",
	"Piper",
	"Sam",
	"Vera"
], T = /* @__PURE__ */ "Achernar.Achird.Algenib.Algieba.Alnilam.Aoede.Autonoe.Callirrhoe.Charon.Despina.Enceladus.Erinome.Fenrir.Gacrux.Iapetus.Kore.Laomedeia.Leda.Orus.Puck.Pulcherrima.Rasalgethi.Sadachbia.Sadaltager.Schedar.Sulafat.Umbriel.Vindemiatrix.Zephyr.Zubenelgenubi".split("."), E = {
	Ben: "Puck",
	Carmen: "Laomedeia",
	Ingrid: "Kore",
	Jay: "Puck",
	Kai: "Fenrir",
	Kira: "Aoede",
	Leo: "Orus",
	Paul: "Charon",
	Piper: "Autonoe",
	Sam: "Schedar",
	Vera: "Erinome"
};
function D(e) {
	return w.includes(e.trim());
}
function O(e) {
	return T.includes(e.trim());
}
function k(e) {
	return E[e.trim()] ?? "";
}
function A(e) {
	let t = e.trim().toLowerCase();
	return `${C}/${t === "carmen" ? "carmen_2.png" : `${t}.png`}`;
}
// ts/webmcp-host.ts
function j(e = typeof document < "u" ? document : void 0) {
	if (!e) return null;
	let t = e.modelContext;
	return t && typeof t.registerTool == "function" && typeof t.getTools == "function" && typeof t.executeTool == "function" ? t : null;
}
var M = class extends Error {
	constructor(e) {
		super(e), this.name = "WebmcpToolError";
	}
}, N = class extends Event {
	constructor(e, t, n, r, i, a) {
		super("call"), this.caller = e, this.name = t, this.args = n, this.result = r, this.ms = i, this.imageDataUrl = a;
	}
};
function P(e) {
	return JSON.stringify(e, (e, t) => t && typeof t == "object" && !Array.isArray(t) ? Object.fromEntries(Object.entries(t).sort(([e], [t]) => e < t ? -1 : +(e > t))) : t);
}
function F(e) {
	let t = {
		...e.readOnly ? { readOnlyHint: !0 } : {},
		...e.consequential ? { consequentialHint: !0 } : {},
		...e.untrusted ? { untrustedContentHint: !0 } : {}
	};
	return Object.keys(t).length ? t : void 0;
}
function I(e) {
	let t = e;
	if (typeof t == "string") try {
		t = JSON.parse(t);
	} catch {
		return null;
	}
	return t && typeof t == "object" && !Array.isArray(t) ? t : null;
}
var L = /parse input arguments|not of type 'object'/i, R = class extends EventTarget {
	constructor(e = (e) => ({ signal: e }), t = j()) {
		super(), this.running = /* @__PURE__ */ new Set(), this.externalCalls = 0, this.diagnostics = {
			schemaType: "",
			argsForm: null,
			firstError: "",
			dropped: [],
			conflicts: []
		}, this.defs = /* @__PURE__ */ new Map(), this.registrations = /* @__PURE__ */ new Map(), this.pendingOwn = /* @__PURE__ */ new Map(), this.inFlight = /* @__PURE__ */ new Map(), this.lastImageByTool = /* @__PURE__ */ new Map(), this.mc = t, this.mode = t ? "webmcp" : "fallback", this.makeContext = e, t?.addEventListener("toolchange", () => this.dispatchEvent(new Event("change")));
	}
	async register(e) {
		for (let t of e) {
			if (this.registrations.has(t.name)) continue;
			let e = new AbortController();
			if (this.defs.set(t.name, t), this.registrations.set(t.name, e), this.mc) try {
				await this.mc.registerTool({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
					annotations: F(t),
					execute: async (e, n) => {
						let r = await this.run(t, e == null ? {} : I(e) ?? e, n?.signal ?? new AbortController().signal, this.pendingOwn.get(t.name)?.shift()?.caller ?? "external");
						return r.imageDataUrl && this.lastImageByTool.set(t.name, r.imageDataUrl), r.result;
					}
				}, { signal: e.signal }), this.diagnostics.conflicts = this.diagnostics.conflicts.filter((e) => !e.startsWith(`${t.name}:`));
			} catch (e) {
				this.registrations.delete(t.name), this.defs.delete(t.name);
				let n = e instanceof Error ? e.message || e.name : String(e);
				this.diagnostics.conflicts.push(`${t.name}: ${n}`), console.error(`registerTool(${t.name}) failed`, e);
			}
		}
		(!this.mc || this.diagnostics.conflicts.length > 0) && this.dispatchEvent(new Event("change"));
	}
	unregister(e) {
		for (let t of e) this.registrations.get(t)?.abort(), this.registrations.delete(t), this.defs.delete(t);
		this.mc || this.dispatchEvent(new Event("change"));
	}
	isRegistered(e) {
		return this.registrations.has(e);
	}
	async list() {
		if (this.mc) {
			let e = typeof window < "u" ? window : void 0, t = (await this.mc.getTools()).filter((t) => !t.window || t.window === e);
			t.length && (this.diagnostics.schemaType = typeof t[0].inputSchema);
			let n = [];
			this.diagnostics.dropped = [];
			for (let e of t) {
				let t = {
					name: e.name,
					description: e.description
				};
				if (e.inputSchema !== void 0 && e.inputSchema !== "") {
					let n = I(e.inputSchema);
					if (!n) {
						this.diagnostics.dropped.push(`${e.name}: unparseable inputSchema`);
						continue;
					}
					t.inputSchema = n;
				}
				this.isOurs(e, t.inputSchema) ? n.push(t) : this.diagnostics.dropped.push(`${e.name}: not registered by this app${this.defs.has(e.name) ? " (description or schema differs)" : ""}`);
			}
			return n;
		}
		return [...this.defs.values()].map((e) => ({
			name: e.name,
			description: e.description,
			inputSchema: e.inputSchema
		})).sort((e, t) => e.name.localeCompare(t.name));
	}
	async call(e, t, n, r = "app") {
		return (await this.callWithOutput(e, t, n, r)).result;
	}
	async callWithOutput(e, t, n, r = "app") {
		let i = { caller: r };
		try {
			if (this.mc) {
				let r = typeof window < "u" ? window : void 0, a = (await this.mc.getTools()).find((t) => t.name === e && (!t.window || t.window === r));
				if (!a) return { result: { error: `Tool ${e} is not available right now.` } };
				let o = a.inputSchema === void 0 || a.inputSchema === "" ? void 0 : I(a.inputSchema) ?? void 0;
				if (!this.isOurs(a, o)) return { result: { error: `Tool ${e} on this page was not registered by this app; refusing to run it.` } };
				this.lastImageByTool.delete(e);
				let s = this.pendingOwn.get(e) ?? [];
				s.push(i), this.pendingOwn.set(e, s);
				let c = await this.executeViaModelContext(a, t, n), l = this.lastImageByTool.get(e);
				return this.lastImageByTool.delete(e), {
					result: z(c),
					imageDataUrl: l
				};
			}
			let a = this.defs.get(e);
			return a ? await this.run(a, t, n, r) : { result: { error: `Tool ${e} is not available right now.` } };
		} catch (e) {
			return n.aborted ? { result: { error: "cancelled" } } : { result: { error: `Tool failed: ${e.message || String(e)}` } };
		} finally {
			let t = this.pendingOwn.get(e), n = t?.indexOf(i) ?? -1;
			t && n >= 0 && t.splice(n, 1);
		}
	}
	isOurs(e, t) {
		let n = this.defs.get(e.name);
		return !!n && n.description === e.description && P(n.inputSchema ?? null) === P(t ?? null);
	}
	async executeViaModelContext(e, t, n) {
		let r = this.mc, i = this.diagnostics, a = i.argsForm ?? (typeof e.inputSchema == "string" ? "string" : "object"), o = (i) => r.executeTool(e, i === "string" ? JSON.stringify(t) : t, { signal: n });
		try {
			let e = await o(a);
			return i.argsForm = a, e;
		} catch (e) {
			let t = e?.message || String(e);
			if (i.argsForm !== null || n.aborted || !L.test(t)) throw e;
			i.firstError = `${a}: ${t}`;
			let r = a === "string" ? "object" : "string", s = await o(r);
			return i.argsForm = r, s;
		}
	}
	async run(e, t, n, r) {
		let i = typeof t == "object" && t && !Array.isArray(t) && e.coalesceInFlight ? `${e.name}:${P(t)}` : null;
		if (i) {
			let e = this.inFlight.get(i);
			if (e) return e;
		}
		let a = this.runSingle(e, t, n, r);
		return i && (this.inFlight.set(i, a), a.finally(() => {
			this.inFlight.get(i) === a && this.inFlight.delete(i);
		})), a;
	}
	async runSingle(e, t, n, r) {
		this.running.add(e.name), this.dispatchEvent(new Event("running")), r === "external" && this.externalCalls++;
		let i = performance.now(), a, o;
		try {
			if (typeof t != "object" || !t || Array.isArray(t)) throw new M("Arguments must be a JSON object.");
			let r = await e.execute(t, this.makeContext(n));
			n.aborted ? a = { error: "cancelled" } : (a = r.result, o = r.imageDataUrl);
		} catch (t) {
			n.aborted ? a = { error: "cancelled" } : t instanceof M ? a = { error: t.message } : (console.error(`tool ${e.name}`, t), a = { error: `Internal error in ${e.name}: ${t.message}` });
		} finally {
			this.running.delete(e.name), this.dispatchEvent(new Event("running"));
		}
		return this.dispatchEvent(new N(r, e.name, t, a, Math.round(performance.now() - i), o)), {
			result: a,
			imageDataUrl: o
		};
	}
};
function z(e) {
	if (e == null || e === "") return {};
	if (typeof e == "object") return Array.isArray(e) ? { result: e } : e;
	if (typeof e != "string") return { result: e };
	try {
		let t = JSON.parse(e);
		return t && typeof t == "object" && !Array.isArray(t) ? t : { result: t };
	} catch {
		return { result: e };
	}
}
// ts/index.ts
var B = "0.1.2";
export { t as AVATAR_LANDSCAPE, e as AVATAR_PORTRAIT, o as CHIME_PRESETS, c as ChimeSynth, l as Fmp4Player, S as LiveSession, m as LiveSocketClient, T as PREBUILT_VOICES, w as PRESET_AVATARS, E as PRESET_AVATAR_VOICES, y as PcmMic, b as PcmPlayer, d as TranscriptAssembler, B as VERSION, x as VisionCapture, N as WebmcpCallEvent, M as WebmcpToolError, R as WebmcpToolHost, F as annotationsFor, I as asObject, p as base64ToArrayBuffer, P as canonicalJSON, v as computeInt16Rms, h as createPcmCaptureContext, k as defaultVoiceForAvatar, f as describeCloseEvent, g as int16ArrayToLittleEndianBytes, O as isPrebuiltVoice, D as isPresetAvatar, j as nativeModelContext, s as normalizeChimePreset, u as parseToolCallItem, n as pickAvatarTarget, r as prepareAvatarImage, A as presetAvatarImageUrl, i as resizeAndCropImage, a as resizeToMaxDimension, _ as uint8ArrayToBase64 };
