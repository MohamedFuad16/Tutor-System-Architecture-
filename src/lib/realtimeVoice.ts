// OpenAI Realtime (WebRTC) voice session — the test/comparison-only path.
//
// This connects the browser straight to OpenAI over WebRTC, so it needs no
// persistent WebSocket server: the only server touchpoint is minting a
// short-lived ephemeral token (POST /api/realtime/token), which even runs on
// Vercel serverless. It exists to benchmark a true full-duplex, uninterrupted
// model against the cheaper Deepgram two-model "duplex" mimic that is the
// product's default — it is intentionally NOT the default and is billed at
// premium realtime rates.

export type RealtimeToolDefinition = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type RealtimeSessionOptions = {
  /** BYOK OpenAI key; empty falls back to the server key (if allowed). */
  openAiKey?: string;
  model?: string;
  voice?: string;
  instructions: string;
  tools?: RealtimeToolDefinition[];
  /** Runs a tool the model called; returns the result to hand back. */
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string, done: boolean) => void;
  onStateChange?: (state: "connecting" | "live" | "closed" | "error") => void;
  onError?: (message: string) => void;
};

export type RealtimeSessionHandle = {
  stop: () => void;
  sendText: (text: string) => void;
};

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

const mintEphemeralToken = async (
  openAiKey: string,
  model: string,
  voice: string,
): Promise<string> => {
  const response = await fetch("/api/realtime/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(openAiKey ? { Authorization: `Bearer ${openAiKey}` } : {}),
    },
    body: JSON.stringify({ model, voice }),
  });
  if (!response.ok) {
    let message = `Realtime token request failed (${response.status}).`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  const data = await response.json();
  if (!data?.value) throw new Error("No Realtime client secret returned.");
  return data.value as string;
};

export const startRealtimeSession = async (
  options: RealtimeSessionOptions,
): Promise<RealtimeSessionHandle> => {
  const model = options.model || "gpt-realtime";
  const voice = options.voice || "marin";
  options.onStateChange?.("connecting");

  const ephemeralKey = await mintEphemeralToken(
    options.openAiKey || "",
    model,
    voice,
  );

  const pc = new RTCPeerConnection();
  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  let micStream: MediaStream | null = null;
  let closed = false;

  const stop = () => {
    if (closed) return;
    closed = true;
    try {
      dc.close();
    } catch {
      /* ignore */
    }
    try {
      pc.getSenders().forEach((sender) => sender.track?.stop());
      pc.close();
    } catch {
      /* ignore */
    }
    micStream?.getTracks().forEach((track) => track.stop());
    remoteAudio.srcObject = null;
    remoteAudio.remove();
    options.onStateChange?.("closed");
  };

  pc.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
  };
  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected" ||
      pc.connectionState === "closed"
    ) {
      if (!closed) {
        options.onError?.(`WebRTC connection ${pc.connectionState}.`);
        stop();
      }
    }
  };

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  micStream.getTracks().forEach((track) => pc.addTrack(track, micStream!));

  const dc = pc.createDataChannel("oai-events");

  const send = (payload: unknown) => {
    if (dc.readyState === "open") dc.send(JSON.stringify(payload));
  };

  dc.onopen = () => {
    // Configure the session: teaching instructions, input transcription, the
    // learner's tool surface, and the output voice.
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: options.instructions,
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
          },
          output: { voice },
        },
        tools: (options.tools || []).map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || {
            type: "object",
            properties: {},
          },
        })),
        tool_choice: "auto",
      },
    });
    options.onStateChange?.("live");
  };

  let assistantBuffer = "";

  dc.onmessage = async (event) => {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "conversation.item.input_audio_transcription.completed": {
        if (msg.transcript) options.onUserTranscript?.(String(msg.transcript));
        break;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        assistantBuffer += msg.delta || "";
        options.onAssistantTranscript?.(assistantBuffer, false);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const finalText = msg.transcript || assistantBuffer;
        options.onAssistantTranscript?.(String(finalText), true);
        assistantBuffer = "";
        break;
      }
      case "response.function_call_arguments.done": {
        if (!options.onToolCall) break;
        let args: Record<string, unknown> = {};
        try {
          args = msg.arguments ? JSON.parse(msg.arguments) : {};
        } catch {
          args = {};
        }
        let result: unknown;
        try {
          result = await options.onToolCall(String(msg.name), args);
        } catch (toolError) {
          result = {
            error:
              toolError instanceof Error
                ? toolError.message
                : "Tool call failed.",
          };
        }
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify(result ?? {}),
          },
        });
        send({ type: "response.create" });
        break;
      }
      case "error": {
        options.onError?.(
          msg.error?.message || "OpenAI Realtime reported an error.",
        );
        break;
      }
      default:
        break;
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpResponse = await fetch(
    `${REALTIME_CALLS_URL}?model=${encodeURIComponent(model)}`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    },
  );
  if (!sdpResponse.ok) {
    stop();
    throw new Error(
      `Realtime WebRTC handshake failed (${sdpResponse.status}).`,
    );
  }
  const answerSdp = await sdpResponse.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    stop,
    sendText: (text: string) => {
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });
      send({ type: "response.create" });
    },
  };
};
