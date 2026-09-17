import { Test, TestingModule } from '@nestjs/testing';
import { MediaStreamService } from './media-stream.service.js';
import { CallsService } from './calls.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { DeepgramService } from '../deepgram/deepgram.service.js';
import { pcm16ToMuLawSample } from './audio-codec.util.js';

describe('MediaStreamService', () => {
  let service: MediaStreamService;
  let callsService: jest.Mocked<Partial<CallsService>>;
  let voiceSessionService: jest.Mocked<Partial<VoiceSessionService>>;
  let deepgramService: jest.Mocked<Partial<DeepgramService>>;
  let mockLiveStreamHandle: any;

  const mockCallControlId1 = 'v3:call_ctrl_aaa_111';
  const mockCallControlId2 = 'v3:call_ctrl_bbb_222';
  const mockClientId1 = 'client-tenant-alpha';
  const mockClientId2 = 'client-tenant-beta';

  const mockActiveCalls = new Map<string, any>([
    [
      mockCallControlId1,
      {
        callControlId: mockCallControlId1,
        clientId: mockClientId1,
        callRecordId: 'rec-1',
        to: '+15551111111',
        from: '+15552222222',
        language: 'en',
        startedAt: new Date(),
        transcript: [],
      },
    ],
    [
      mockCallControlId2,
      {
        callControlId: mockCallControlId2,
        clientId: mockClientId2,
        callRecordId: 'rec-2',
        to: '+15553333333',
        from: '+15554444444',
        language: 'hi',
        startedAt: new Date(),
        transcript: [],
      },
    ],
  ]);

  function generateMuLawFrame(amplitude: number, count = 160): Buffer {
    const buf = Buffer.alloc(count);
    const muByte = pcm16ToMuLawSample(amplitude);
    buf.fill(muByte);
    return buf;
  }

  beforeEach(async () => {
    callsService = {
      getActiveCall: jest.fn((id: string) => mockActiveCalls.get(id)),
      processCallerUtterance: jest.fn().mockResolvedValue({
        responseText: 'Agent response',
        source: 'rag',
      }),
    };

    voiceSessionService = {
      updateActivity: jest.fn(),
      getSession: jest.fn().mockReturnValue({ id: 'sess-1' }),
    };

    mockLiveStreamHandle = {
      sendAudio: jest.fn(),
      finish: jest.fn(),
      close: jest.fn(),
      isActive: jest.fn().mockReturnValue(true),
    };

    deepgramService = {
      createLiveStream: jest.fn().mockReturnValue(mockLiveStreamHandle),
      closeLiveStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaStreamService,
        { provide: CallsService, useValue: callsService },
        { provide: VoiceSessionService, useValue: voiceSessionService },
        { provide: DeepgramService, useValue: deepgramService },
      ],
    }).compile();

    service = module.get<MediaStreamService>(MediaStreamService);
  });

  afterEach(() => {
    service.clearAllSessions();
    jest.clearAllMocks();
  });

  describe('Connection & Session Association', () => {
    it('1. should associate media connection with correct call session and client tenant', async () => {
      const mockWs = {} as any;
      const startPayload = {
        event: 'start' as const,
        stream_id: 'stream-alpha-123',
        call_control_id: mockCallControlId1,
      };

      await service.handleWebSocketMessage(mockWs, JSON.stringify(startPayload));

      const session = service.getSession('stream-alpha-123');
      expect(session).toBeDefined();
      expect(session?.callControlId).toBe(mockCallControlId1);
      expect(session?.clientId).toBe(mockClientId1);
      expect(voiceSessionService.updateActivity).toHaveBeenCalledWith(mockCallControlId1);
    });

    it('2. should reject media connection for unknown call_control_id', async () => {
      const mockWs = {} as any;
      const startPayload = {
        event: 'start' as const,
        stream_id: 'stream-unknown',
        call_control_id: 'v3:call_ctrl_nonexistent',
      };

      await service.handleWebSocketMessage(mockWs, JSON.stringify(startPayload));

      const session = service.getSession('stream-unknown');
      expect(session).toBeUndefined();
    });

    it('3. should safely reject malformed JSON without crashing', async () => {
      const mockWs = {} as any;
      await expect(
        service.handleWebSocketMessage(mockWs, 'not-valid-json{{{'),
      ).resolves.not.toThrow();
    });
  });

  describe('Media Routing & Speech Processing', () => {
    it('4. should route incoming media frames to correct call_control_id and trigger processCallerUtterance upon silence', async () => {
      const mockWs = {} as any;
      const streamId = 'stream-speech-test';

      // Start stream
      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'start',
          stream_id: streamId,
          call_control_id: mockCallControlId1,
        }),
      );

      // Send 15 frames of speech (amplitude = 2000, 300ms)
      const speechFrame = generateMuLawFrame(2000);
      for (let i = 0; i < 15; i++) {
        await service.handleWebSocketMessage(
          mockWs,
          JSON.stringify({
            event: 'media',
            stream_id: streamId,
            media: { payload: speechFrame.toString('base64') },
          }),
        );
      }

      // ProcessCallerUtterance should not be called yet while speech is continuing
      expect(callsService.processCallerUtterance).not.toHaveBeenCalled();

      // Send 18 frames of silence (amplitude = 0, ~360ms)
      const silenceFrame = generateMuLawFrame(0);
      for (let i = 0; i < 18; i++) {
        await service.handleWebSocketMessage(
          mockWs,
          JSON.stringify({
            event: 'media',
            stream_id: streamId,
            media: { payload: silenceFrame.toString('base64') },
          }),
        );
      }

      // Now processCallerUtterance MUST be called with valid WAV buffer
      expect(callsService.processCallerUtterance).toHaveBeenCalledTimes(1);
      const [calledControlId, utteranceInput] = (
        callsService.processCallerUtterance as jest.Mock
      ).mock.calls[0];

      expect(calledControlId).toBe(mockCallControlId1);
      expect(utteranceInput.audioBuffer).toBeDefined();
      expect(utteranceInput.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(utteranceInput.audioBuffer.subarray(8, 12).toString('ascii')).toBe('WAVE');

      // Verify Deepgram live stream was created and received audio frames
      expect(deepgramService.createLiveStream).toHaveBeenCalledWith(
        mockCallControlId1,
        expect.any(Object),
      );
      expect(mockLiveStreamHandle.sendAudio).toHaveBeenCalled();
    });

    it('4a. should discard brief audio under 200ms (clicks / noise) without triggering utterance processing', async () => {
      const mockWs = {} as any;
      const streamId = 'stream-noise-test';

      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'start',
          stream_id: streamId,
          call_control_id: mockCallControlId1,
        }),
      );

      // Send 5 frames of speech (< 100ms, less than minSpeechFrames=10)
      const speechFrame = generateMuLawFrame(2000);
      for (let i = 0; i < 5; i++) {
        await service.handleWebSocketMessage(
          mockWs,
          JSON.stringify({
            event: 'media',
            stream_id: streamId,
            media: { payload: speechFrame.toString('base64') },
          }),
        );
      }

      // Send 18 frames of silence
      const silenceFrame = generateMuLawFrame(0);
      for (let i = 0; i < 18; i++) {
        await service.handleWebSocketMessage(
          mockWs,
          JSON.stringify({
            event: 'media',
            stream_id: streamId,
            media: { payload: silenceFrame.toString('base64') },
          }),
        );
      }

      // Utterance should be discarded because speech was under 200ms
      expect(callsService.processCallerUtterance).not.toHaveBeenCalled();
    });

    it('4b. should trigger processCallerUtterance immediately when Deepgram speech_final event occurs', async () => {
      const mockWs = {} as any;
      const streamId = 'stream-dg-event-test';

      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'start',
          stream_id: streamId,
          call_control_id: mockCallControlId1,
        }),
      );

      // Extract onTranscript callback passed to createLiveStream
      const createCallArgs = (deepgramService.createLiveStream as jest.Mock).mock.calls[0];
      const streamOptions = createCallArgs[1];

      // Simulate interim transcript
      await streamOptions.onTranscript('What are your', false, false);
      expect(callsService.processCallerUtterance).not.toHaveBeenCalled();

      // Simulate speech_final transcript
      await streamOptions.onTranscript('What are your opening hours?', true, true);
      expect(callsService.processCallerUtterance).toHaveBeenCalledWith(
        mockCallControlId1,
        { transcript: 'What are your opening hours?' },
      );
    });

    it('5. should reject media frames for terminated / hung up calls', async () => {
      const mockWs = {} as any;
      const streamId = 'stream-terminated-test';

      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'start',
          stream_id: streamId,
          call_control_id: mockCallControlId1,
        }),
      );

      // Simulate call termination in CallsService
      (callsService.getActiveCall as jest.Mock).mockReturnValue(undefined);

      const speechFrame = generateMuLawFrame(2000);
      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'media',
          stream_id: streamId,
          media: { payload: speechFrame.toString('base64') },
        }),
      );

      // Session should be cleaned up and no speech processed
      expect(service.getSession(streamId)).toBeUndefined();
      expect(callsService.processCallerUtterance).not.toHaveBeenCalled();
    });
  });

  describe('Tenant & Call Isolation', () => {
    it('6. should maintain strict isolation between simultaneous calls and tenants', async () => {
      const mockWs1 = {} as any;
      const mockWs2 = {} as any;
      const streamId1 = 'stream-call-1';
      const streamId2 = 'stream-call-2';

      // Start stream 1 for tenant 1
      await service.handleWebSocketMessage(
        mockWs1,
        JSON.stringify({
          event: 'start',
          stream_id: streamId1,
          call_control_id: mockCallControlId1,
        }),
      );

      // Start stream 2 for tenant 2
      await service.handleWebSocketMessage(
        mockWs2,
        JSON.stringify({
          event: 'start',
          stream_id: streamId2,
          call_control_id: mockCallControlId2,
        }),
      );

      const session1 = service.getSession(streamId1);
      const session2 = service.getSession(streamId2);

      expect(session1?.clientId).toBe(mockClientId1);
      expect(session2?.clientId).toBe(mockClientId2);
      expect(session1?.callControlId).toBe(mockCallControlId1);
      expect(session2?.callControlId).toBe(mockCallControlId2);

      // Stream speech only to call 2
      const speechFrame = generateMuLawFrame(2500);
      for (let i = 0; i < 15; i++) {
        await service.handleWebSocketMessage(
          mockWs2,
          JSON.stringify({
            event: 'media',
            stream_id: streamId2,
            media: { payload: speechFrame.toString('base64') },
          }),
        );
      }
      const silenceFrame = generateMuLawFrame(0);
      for (let i = 0; i < 30; i++) {
        await service.handleWebSocketMessage(
          mockWs2,
          JSON.stringify({
            event: 'media',
            stream_id: streamId2,
            media: { payload: silenceFrame.toString('base64') },
          }),
        );
      }

      // Verification: ONLY Call 2 was dispatched to processCallerUtterance
      expect(callsService.processCallerUtterance).toHaveBeenCalledTimes(1);
      expect(callsService.processCallerUtterance).toHaveBeenCalledWith(
        mockCallControlId2,
        expect.objectContaining({ audioBuffer: expect.any(Buffer) }),
      );
      expect(callsService.processCallerUtterance).not.toHaveBeenCalledWith(
        mockCallControlId1,
        expect.anything(),
      );
    });
  });

  describe('Teardown & Cleanup', () => {
    it('7. should cleanly remove session on stop event', async () => {
      const mockWs = {} as any;
      const streamId = 'stream-stop-test';

      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'start',
          stream_id: streamId,
          call_control_id: mockCallControlId1,
        }),
      );

      expect(service.getSession(streamId)).toBeDefined();

      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'stop',
          stream_id: streamId,
        }),
      );

      expect(service.getSession(streamId)).toBeUndefined();
    });

    it('8. should cleanly remove session on WebSocket close event', async () => {
      const mockWs = { id: 'ws-unique' } as any;
      const streamId = 'stream-ws-close';

      await service.handleWebSocketMessage(
        mockWs,
        JSON.stringify({
          event: 'start',
          stream_id: streamId,
          call_control_id: mockCallControlId1,
        }),
      );

      expect(service.getSession(streamId)).toBeDefined();
      service.handleWebSocketClose(mockWs);
      expect(service.getSession(streamId)).toBeUndefined();
    });
  });
});
