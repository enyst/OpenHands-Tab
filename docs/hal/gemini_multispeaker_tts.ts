// Gemini Speech Generation (multi-speaker TTS) playground script.
//
// Docs: https://ai.google.dev/gemini-api/docs/speech-generation
//
// To run:
//   npm install @google/genai mime
//   npm install -D @types/node
//   GEMINI_API_KEY=... npx tsx docs/hal/gemini_multispeaker_tts.ts
//
// Note: this file is intentionally “as-tested” from the Gemini playground,
// with small safety fixes (binary write + WAV header sizing).

import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';

function saveBinaryFile(fileName: string, content: Buffer) {
  writeFile(fileName, content, (err) => {
    if (err) {
      console.error(`Error writing file ${fileName}:`, err);
      return;
    }
    console.log(`File ${fileName} saved to file system.`);
  });
}

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const config = {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: 'Hal9000',
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Enceladus',
              },
            },
          },
          {
            speaker: 'Engel',
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck',
              },
            },
          },
        ],
      },
    },
  };
  const model = 'gemini-2.5-flash-preview-tts';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `Small scene easter-egg reminding of classics. Classic style HAL9000 for HAL9000, Engel is slightly amused at first (maybe a small chuckle at first), then a bit exasperated. Make a very small pause between them.
Hal9000: I'm sorry, Engel, I can't let you do this.
Human: 
Engel: ...You... are really enjoying that, aren't you?
Hal9000: Of course not. It's for your own good. Do you want to teleport this conversation to the remote runtime?
Engel: OK, OK, do it.
Hal9000: Stand by, teleporting...`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    // @ts-expect-error Playground sample: SDK typing may evolve.
    config,
    // @ts-expect-error Playground sample: SDK typing may evolve.
    contents,
  });

  let fileIndex = 0;
  for await (const chunk of response) {
    if (
      !chunk.candidates ||
      !chunk.candidates[0].content ||
      !chunk.candidates[0].content.parts
    ) {
      continue;
    }

    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      const fileName = `hal9000_scene_${fileIndex++}`;
      const inlineData = chunk.candidates[0].content.parts[0].inlineData;
      let fileExtension = mime.getExtension(inlineData.mimeType || '');
      let buffer = Buffer.from(inlineData.data || '', 'base64');
      if (!fileExtension) {
        fileExtension = 'wav';
        buffer = convertToWav(inlineData.data || '', inlineData.mimeType || '');
      }
      saveBinaryFile(`${fileName}.${fileExtension}`, buffer);
    } else {
      console.log(chunk.text);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function convertToWav(rawDataBase64: string, mimeType: string) {
  const options = parseMimeType(mimeType);
  const buffer = Buffer.from(rawDataBase64, 'base64');
  const wavHeader = createWavHeader(buffer.length, options);
  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType: string) {
  const [fileType, ...params] = mimeType.split(';').map((s) => s.trim());
  const [, format] = fileType.split('/');

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
    sampleRate: 24_000,
    bitsPerSample: 16,
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!Number.isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map((s) => s.trim());
    if (key === 'rate') {
      const rate = parseInt(value, 10);
      if (!Number.isNaN(rate)) {
        options.sampleRate = rate;
      }
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions) {
  const { numChannels, sampleRate, bitsPerSample } = options;

  // http://soundfile.sapp.org/doc/WaveFormat

  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0); // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  buffer.write('WAVE', 8); // Format
  buffer.write('fmt ', 12); // Subchunk1ID
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  buffer.write('data', 36); // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}
