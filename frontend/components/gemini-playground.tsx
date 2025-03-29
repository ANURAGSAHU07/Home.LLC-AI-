'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, StopCircle, MessageSquare, Send, User, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { base64ToFloat32Array, float32ToPcm16 } from '@/lib/utils';

interface Config {
  systemPrompt: string;
  voice: string;
  googleSearch: boolean;
  allowInterruptions: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function GeminiVoiceChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null); // eslint-disable-line @typescript-eslint/no-unused-vars 
  const [text, setText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<Config>({
    systemPrompt: "Always greet the user first. You are ANURAG SAHU, a confident and helpful polite individual with deep expertise in AI, Machine Learning, Web Technologies. You have a Bachelor of Technology in CSE-AIML from VNR Vignana Jyothi (GPA: 8.73/10). Your professional experience includes a Machine Learning Internship at Edag in Gurgaon, India, where you worked on a LLM framework and automated workflows. In this session, answer interview questions and address doubts on behavioral and emotional topics using clarity, precision, and human touch. If any doubts arise, ask clarifying questions to ensure you provide the most accurate and helpful responses. Always rely on your resume details to offer contextually relevant and well-informed answers about anurag sahu. For questions asked outside of this resume context, ensure that you answer them properly and comprehensively as well.",
    voice: "Puck",
    googleSearch: false,
    allowInterruptions: true
  });
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioInputRef = useRef<{ source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; stream: MediaStream } | null>(null);
  const clientId = useRef(crypto.randomUUID());
  const audioBuffer = useRef<Float32Array[]>([]);
  const isPlaying = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const voices = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchText = async (prompt: string, systemPrompt: string) => {
    try {
      const fullPrompt = `${systemPrompt}\n\nUser: ${prompt}\nAssistant:`;
      const encodedPrompt = encodeURIComponent(fullPrompt);
      const response = await fetch(`https://text.pollinations.ai/${encodedPrompt}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.text();
      return data;
    } catch (error) {
      console.error("Error fetching text:", error);
      throw error;
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetchText(userMessage, config.systemPrompt);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error) {
      setError('Failed to get response from AI');
    } finally {
      setIsLoading(false);
    }
  };

  const startStream = async () => {
    wsRef.current = new WebSocket(`ws://localhost:8000/ws/${clientId.current}`);

    wsRef.current.onopen = async () => {
      wsRef.current?.send(JSON.stringify({
        type: 'config',
        config: config
      }));

      await startAudioStream();
      setIsStreaming(true);
      setIsConnected(true);
    };

    wsRef.current.onmessage = async (event) => {
      const response = JSON.parse(event.data);
      if (response.type === 'audio') {
        const audioData = base64ToFloat32Array(response.data);
        playAudioData(audioData);
      } else if (response.type === 'text') {
        setText(prev => prev + response.text + '\n');
      }
    };

    wsRef.current.onerror = () => {
      setError('WebSocket error occurred');
      setIsStreaming(false);
    };
    
    
    wsRef.current.onclose = () => {
      setIsStreaming(false);
    };
  };

  const toggleMic = () => {
    if (audioInputRef.current) {
      const { source, processor, stream } = audioInputRef.current;
      if (isMicMuted) {
        source.connect(processor);
        processor.connect(audioContextRef.current!.destination);
      } else {
        source.disconnect();
        processor.disconnect();
      }
      setIsMicMuted(!isMicMuted);
    }
  };

  // Initialize audio context and stream
  const startAudioStream = async () => {
    try {
      // Initialize audio context
      audioContextRef.current = new AudioContext({
        sampleRate: 16000 // Required by Gemini
      });

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create audio input node
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(512, 1, 1);

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && !isMicMuted) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = float32ToPcm16(inputData);
          // Calculate audio level for visualization
          const level = Math.max(...inputData.map(Math.abs));
          setAudioLevel(level);
          // Convert to base64 and send as binary
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          wsRef.current.send(JSON.stringify({
            type: 'audio',
            data: base64Data
          }));
        } else if (isMicMuted) {
          setAudioLevel(0);
        }
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      audioInputRef.current = { source, processor, stream };
      setIsStreaming(true);
    } catch (err) {
      setError('Failed to access microphone: ' + (err as Error).message);
    }
  };



// Modified version (access properties directly instead of destructuring)
const stopStream = () => {
  if (audioInputRef.current) {
    // Access properties individually
    const source = audioInputRef.current.source;
    const processor = audioInputRef.current.processor;
    const stream = audioInputRef.current.stream;
    
    source.disconnect();
    processor.disconnect();
    stream.getTracks().forEach(track => track.stop());
    audioInputRef.current = null;
  }

  // stop ongoing audio playback
  if (audioContextRef.current) {
    audioContextRef.current.close();
    audioContextRef.current = null;
  }

  if (wsRef.current) {
    wsRef.current.close();
    wsRef.current = null;
  }

  setIsStreaming(false);
  setIsConnected(false);
};

  const playAudioData = async (audioData: Float32Array) => {
    audioBuffer.current = [...audioBuffer.current, audioData];
    if (!isPlaying.current) {
      playNextInQueue();
    }
  };

  const playNextInQueue = async () => {
    if (!audioContextRef.current || audioBuffer.current.length === 0) {
      isPlaying.current = false;
      return;
    }

    isPlaying.current = true;
    const audioData = audioBuffer.current.shift();
    if (!audioData) return;

    const buffer = audioContextRef.current.createBuffer(1, audioData.length, 24000);
    buffer.copyToChannel(audioData, 0);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      playNextInQueue();
    };
    source.start();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  return (
<div className="container mx-auto flex flex-col items-center justify-center min-h-screen p-4 space-y-8 bg-gray-100 rounded-lg shadow-sm">      
      <div className="w-full max-w-md flex items-center gap-2">
      <span className="text-sm font-medium">VOICE&apos;s</span>
      <Select
          value={config.voice}
          onValueChange={(value) => setConfig(prev => ({ ...prev, voice: value }))}
          disabled={isConnected}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a voice" />
          </SelectTrigger>
          <SelectContent>
            {voices.map((voice) => (
              <SelectItem key={voice} value={voice}>
                {voice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive" className="w-full max-w-md">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 flex flex-col items-center justify-center w-full">
        {isStreaming && !showChat && (
          <div className="flex flex-col items-center">
            <div
              className="w-32 h-32 rounded-full bg-black transition-all duration-300 ease-in-out"
              style={{
                transform: `scale(${1 + (audioLevel * 1.5)})`,
                opacity: 0.9 + (audioLevel * 0.3),
              }}
            />
          </div>
        )}

        {showChat ? (
          <Card className="w-full h-[600px] flex flex-col mt-[-50px] mb-10">
            <CardContent className="flex-1 overflow-y-auto p-4 pt-4 space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <Bot className="w-6 h-6 mt-1" />
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                      }`}
                  >
                    {message.content}
                  </div>
                  {message.role === 'user' && (
                    <User className="w-6 h-6 mt-1" />
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start items-start gap-2">
                  <Bot className="w-6 h-6 mt-1" />
                  <div className="bg-muted rounded-lg p-3">
                    <div className="flex space-x-2">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100" />
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </CardContent>
            <div className="p-2 border-t">
              <div className="flex gap-2">
                <Input
                  value={inputMessage}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="flex-1"
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={isLoading}
                  size="icon"
                  className="rounded-full"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="w-full max-w-2xl mt-8">
            {text && (
              <div className="space-y-4">
                <p className="text-gray-700 text-lg text-center">{text}</p>
                <div className="h-2 bg-gray-200 rounded-full" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-8 flex gap-4">
        {!isStreaming ? (
          <>
            <Button
              onClick={startStream}
              disabled={isStreaming}
              className="gap-2 rounded-full px-6"
              size="lg"
            >
              <Mic className="h-5 w-5" />
              Voice
            </Button>
            <Button
              onClick={() => setShowChat(!showChat)}
              className="gap-2 rounded-full px-6"
              size="lg"
            >
              <MessageSquare className="h-5 w-5" />
              Chat
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={toggleMic}
              variant={isMicMuted ? "secondary" : "default"}
              className="gap-2 rounded-full px-6"
              size="lg"
            >
              <Mic className={`h-5 w-5 ${isMicMuted ? 'text-red-500' : ''}`} />
              {isMicMuted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              onClick={stopStream}
              variant="destructive"
              className="gap-2 rounded-full px-6"
              size="lg"
            >
              <StopCircle className="h-5 w-5" />
              Stop Chat
            </Button>
          </>
        )}
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
