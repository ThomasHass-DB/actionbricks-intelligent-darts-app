/**
 * Kinesis Video Streams WebRTC viewer helper — pure browser implementation.
 *
 * Connects to a KVS signaling channel as a VIEWER using native WebSocket
 * and RTCPeerConnection. No AWS SDK needed in the browser.
 *
 * The backend provides a SigV4 pre-signed WSS URL and ICE servers (including
 * TURN credentials). The browser establishes the signaling WebSocket, exchanges
 * SDP offers/answers and ICE candidates with the master (Raspberry Pi),
 * and yields a MediaStream to render into a <video> element.
 */

import type { ViewerConnectionInfo } from "./api";

export interface KinesisViewerSession {
  /** The remote media stream from the master. */
  remoteStream: MediaStream;
  /** Call to tear down the peer connection and WebSocket. */
  close: () => void;
}

/**
 * KVS signaling message format (JSON over WSS).
 *
 * IMPORTANT: KVS uses different field names for outgoing vs incoming messages:
 *   - Outgoing (client → KVS):  { action: "SDP_OFFER", messagePayload: "..." }
 *   - Incoming (KVS → client):  { messageType: "SDP_ANSWER", messagePayload: "...", senderClientId: "..." }
 */
interface KvsOutgoingMessage {
  action: "SDP_OFFER" | "SDP_ANSWER" | "ICE_CANDIDATE";
  messagePayload: string; // base64-encoded JSON
  recipientClientId?: string;
  correlationId?: string;
}

interface KvsIncomingMessage {
  messageType: "SDP_OFFER" | "SDP_ANSWER" | "ICE_CANDIDATE" | "GO_AWAY" | "RECONNECT_ICE_SERVER" | "STATUS_RESPONSE";
  messagePayload: string; // base64-encoded
  senderClientId?: string;
  statusResponse?: {
    correlationId?: string;
    errorType?: string;
    statusCode?: string;
    description?: string;
  };
}

/**
 * Open a WebRTC viewer connection to a KVS signaling channel.
 *
 * @param info      Connection info returned by `GET /api/kinesis/viewer-config`
 * @param clientId  A unique viewer client ID (used for logging only)
 * @returns A promise that resolves once the remote stream has at least one video track.
 */
export function connectAsViewer(
  info: ViewerConnectionInfo,
  clientId: string,
): Promise<KinesisViewerSession> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    // Phase tracking for diagnostics
    const phases = {
      wsConnected: false,
      offerSent: false,
      answerReceived: false,
      iceConnected: false,
      trackReceived: false,
    };

    const log = (msg: string) =>
      console.log(`[kinesis-viewer:${clientId}] ${msg}`);
    const logError = (msg: string, err?: unknown) =>
      console.error(`[kinesis-viewer:${clientId}] ${msg}`, err ?? "");

    // Use the pre-signed WSS URL from the backend (SigV4 authenticated)
    const signedUrl = info.signed_wss_url || info.wss_endpoint;

    // Log URL structure (without the full signature) for debugging
    try {
      const u = new URL(signedUrl);
      log(
        `Connecting to wss://${u.host}${u.pathname} with params: ${[...u.searchParams.keys()].join(", ")}`,
      );
    } catch {
      log("Connecting to pre-signed WSS URL");
    }

    const ws = new WebSocket(signedUrl);

    const remoteStream = new MediaStream();

    const iceServers: RTCIceServer[] = (info.ice_servers ?? []).map((s) => ({
      urls: s.urls,
      username: s.username || undefined,
      credential: s.credential || undefined,
    }));

    log(`ICE servers: ${iceServers.map((s) => (Array.isArray(s.urls) ? s.urls[0] : s.urls)).join(", ")}`);

    let peerConnection: RTCPeerConnection | null = null;
    let trackTimeout: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      if (trackTimeout) clearTimeout(trackTimeout);
      try {
        peerConnection?.close();
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      peerConnection = null;
    }

    function phaseStatus(): string {
      const p = phases;
      const steps = [];
      steps.push(p.wsConnected ? "WS:OK" : "WS:pending");
      steps.push(p.offerSent ? "Offer:sent" : "Offer:pending");
      steps.push(p.answerReceived ? "Answer:OK" : "Answer:pending");
      steps.push(p.iceConnected ? "ICE:OK" : "ICE:pending");
      steps.push(p.trackReceived ? "Track:OK" : "Track:pending");
      return steps.join(" → ");
    }

    // Time out after 30s if no track arrives
    trackTimeout = setTimeout(() => {
      if (!resolved) {
        const status = phaseStatus();
        logError(`Timeout! Phase status: ${status}`);
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Timed out waiting for remote video track (${status})`,
          ),
        );
      }
    }, 30_000);

    ws.onopen = async () => {
      phases.wsConnected = true;
      log("WebSocket opened");

      peerConnection = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: "all",
      });

      // When the master sends us media, add tracks to our stream
      peerConnection.ontrack = (event) => {
        log(`Got remote track: ${event.track.kind} (id=${event.track.id})`);
        phases.trackReceived = true;
        remoteStream.addTrack(event.track);

        if (!resolved && remoteStream.getVideoTracks().length > 0) {
          resolved = true;
          if (trackTimeout) clearTimeout(trackTimeout);
          log("Connection established! Remote video track received.");
          resolve({ remoteStream, close: cleanup });
        }
      };

      // Send ICE candidates to the master via signaling
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          log(`Sending ICE candidate: ${event.candidate.candidate.substring(0, 60)}...`);
          const msg: KvsOutgoingMessage = {
            action: "ICE_CANDIDATE",
            messagePayload: btoa(JSON.stringify(event.candidate.toJSON())),
          };
          ws.send(JSON.stringify(msg));
        } else {
          log("ICE gathering complete (null candidate)");
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection?.iceConnectionState;
        log(`ICE connection state: ${state}`);
        if (state === "connected" || state === "completed") {
          phases.iceConnected = true;
        }
        if (state === "failed" || state === "disconnected") {
          logError(`ICE connection ${state}`);
        }
      };

      peerConnection.onconnectionstatechange = () => {
        log(`Connection state: ${peerConnection?.connectionState}`);
      };

      peerConnection.onsignalingstatechange = () => {
        log(`Signaling state: ${peerConnection?.signalingState}`);
      };

      // Add transceivers to receive media (viewer doesn't send)
      peerConnection.addTransceiver("video", { direction: "recvonly" });
      peerConnection.addTransceiver("audio", { direction: "recvonly" });

      // Create SDP offer and send it
      try {
        const offer = await peerConnection.createOffer({
          offerToReceiveVideo: true,
          offerToReceiveAudio: true,
        });
        await peerConnection.setLocalDescription(offer);
        log("Sending SDP offer");
        // KVS protocol: messagePayload = base64(JSON.stringify(RTCSessionDescription))
        // The master expects a JSON object with {type, sdp}, not raw SDP text
        const sdpPayload = JSON.stringify({
          type: peerConnection.localDescription!.type,
          sdp: peerConnection.localDescription!.sdp,
        });
        const msg: KvsOutgoingMessage = {
          action: "SDP_OFFER",
          messagePayload: btoa(sdpPayload),
          correlationId: `offer-${Date.now()}`,
        };
        ws.send(JSON.stringify(msg));
        phases.offerSent = true;
        log("SDP offer sent, waiting for answer from master...");
      } catch (err) {
        logError("Failed to create/send offer:", err);
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      }
    };

    ws.onmessage = async (event) => {
      try {
        const raw =
          typeof event.data === "string"
            ? event.data
            : await (event.data as Blob).text();

        log(`Received signaling message: ${raw.substring(0, 200)}...`);

        const msg: KvsIncomingMessage = JSON.parse(raw);

        // KVS incoming messages use "messageType" (not "action")
        if (msg.messageType === "SDP_ANSWER" && peerConnection) {
          phases.answerReceived = true;
          log("Received SDP answer from master");
          // KVS protocol: messagePayload = base64(JSON.stringify({type, sdp}))
          const decoded = atob(msg.messagePayload);
          let remoteDesc: RTCSessionDescriptionInit;
          try {
            // Try parsing as JSON object first (standard KVS format)
            const parsed = JSON.parse(decoded);
            remoteDesc = { type: parsed.type || "answer", sdp: parsed.sdp || decoded };
          } catch {
            // Fallback: raw SDP string
            remoteDesc = { type: "answer", sdp: decoded };
          }
          await peerConnection.setRemoteDescription(remoteDesc);
          log("Remote description set, waiting for ICE + tracks...");
        } else if (msg.messageType === "ICE_CANDIDATE" && peerConnection) {
          log("Received ICE candidate from master");
          // KVS protocol: messagePayload = base64(JSON.stringify(RTCIceCandidate))
          const decoded = atob(msg.messagePayload);
          let candidate: RTCIceCandidateInit;
          try {
            candidate = JSON.parse(decoded);
          } catch {
            log("Could not parse ICE candidate JSON, skipping");
            return;
          }
          await peerConnection.addIceCandidate(candidate);
        } else if (msg.messageType === "STATUS_RESPONSE" && msg.statusResponse) {
          log(
            `Status response: code=${msg.statusResponse.statusCode} error=${msg.statusResponse.errorType} desc=${msg.statusResponse.description}`,
          );
          // If the status indicates an error, reject
          if (msg.statusResponse.errorType && !resolved) {
            resolved = true;
            cleanup();
            reject(
              new Error(
                `KVS signaling error: ${msg.statusResponse.errorType} — ${msg.statusResponse.description}`,
              ),
            );
          }
        } else if (msg.messageType === "GO_AWAY") {
          log("Received GO_AWAY from signaling service");
        } else {
          log(`Unhandled signaling messageType: ${msg.messageType}`);
        }
      } catch (err) {
        logError("Error handling signaling message:", err);
      }
    };

    ws.onerror = (event) => {
      logError("WebSocket error:", event);
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error("WebSocket connection failed"));
      }
    };

    ws.onclose = (event) => {
      log(
        `WebSocket closed: code=${event.code}, reason=${event.reason || "none"}, clean=${event.wasClean}`,
      );
      // If the WebSocket closes before we resolved, treat it as an error
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `WebSocket closed unexpectedly: code=${event.code} reason=${event.reason || "none"} (${phaseStatus()})`,
          ),
        );
      }
    };
  });
}
