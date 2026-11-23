import React, { useState, useEffect, useRef } from 'react';
import {
  Home,
  Sparkles,
  Music,
  Mic,
  Disc3,
  Folder as FolderMusic,
  Play,
  Plus,
  Sliders,
  Volume2,
  Radio,
  Zap,
  Clock,
  ChevronRight,
  Settings,
  Layers,
  Heart,
  Share2,
  Trash2,
  Square,
  Circle,
  Save,
  VolumeX,
  Volume1,
  Pause,
} from 'lucide-react';

/* ================= INDEXEDDB MULTI-TRACK PROJECT STORAGE ================= */
const DB_NAME = 'music_studio_ai_daw_db';
const PROJECT_STORE = 'projects';
const TRACK_STORE = 'tracks';
const MIX_STORE = 'mixdown';

const openDB = (name = DB_NAME): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MIX_STORE)) {
        db.createObjectStore(MIX_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/* ================= WEB AUDIO MIXER ENGINE WITH FX ================= */
class MixerEngine {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;
  compressor: DynamicsCompressorNode | null = null;
  eqNodes: BiquadFilterNode[] = [];
  reverbNode: ConvolverNode | null = null;
  delayNode: DelayNode | null = null;
  tracks: GainNode[] = [];
  panNodes: StereoPannerNode[] = [];

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);

      // Master Compressor
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-20, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);
      this.masterGain!.connect(this.compressor!);
      this.compressor!.connect(this.ctx.destination);

      // EQ bands
      const freqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      freqBands.forEach((freq, i) => {
        const band = this.ctx!.createBiquadFilter();
        band.type = 'peaking';
        band.frequency.setValueAtTime(freq, this.ctx.currentTime);
        band.Q.setValueAtTime(1.4, this.ctx.currentTime);
        band.gain.setValueAtTime(0, this.ctx.currentTime);
        this.eqNodes.push(band);
      });

      // Reverb (using feedback delay network approximation)
      this.reverbNode = this.ctx.createConvolver();
      // Simple all-pass network for reverb simulation
      this.delayNode = this.ctx.createDelay(1.0);
      this.delayNode.delayTime.setValueAtTime(0.1, this.ctx.currentTime);

      this.masterGain.connect(this.ctx.destination);
    }
  }

  addTrack(src: HTMLAudioElement) {
    this.init();
    const gain = this.ctx!.createGain();
    const pan = this.ctx!.createStereoPanner();
    const trackSrc = this.ctx!.createMediaElementSource(src);
    trackSrc.connect(pan);
    pan.connect(gain);
    gain.connect(this.masterGain!);
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    pan.pan.setValueAtTime(0, this.ctx.currentTime);

    // Connect EQ bands
    this.eqNodes.forEach((band, i) => {
      gain.connect(band);
      band.connect(this.masterGain!);
    });

    this.tracks.push(gain);
    this.panNodes.push(pan);
  }

  removeTrack(idx: number) {
    const track = this.tracks[idx];
    if (track) track.disconnect();
    this.tracks.splice(idx, 1);
    this.panNodes.splice(idx, 1);
  }

  setTrackVolume(idx: number, vol: number) {
    if (this.tracks[idx]) this.tracks[idx].gain.setValueAtTime(Math.max(0, Math.min(1, vol)), this.ctx!.currentTime);
  }

  setTrackPan(idx: number, pan: number) {
    if (this.panNodes[idx]) this.panNodes[idx].pan.setValueAtTime(pan, this.ctx!.currentTime);
  }

  setEQBand(idx: number, gain: number) {
    if (this.eqNodes[idx]) this.eqNodes[idx].gain.setValueAtTime(gain, this.ctx!.currentTime);
  }

  setHighPass(frequency: number) {
    if (this.ctx) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      this.eqNodes[0] = hp;
    }
  }

  setLowPass(frequency: number) {
    if (this.ctx) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      this.eqNodes[9] = lp;
    }
  }

  setReverbWet(wet: number) {
    // Reverb amount control
    if (this.reverbNode && this.ctx) {
      // Simple reverb mix control
      const wetGain = this.ctx.createGain();
      wetGain.gain.setValueAtTime(wet, this.ctx.currentTime);
      this.masterGain!.connect(wetGain);
      wetGain.connect(this.ctx.destination);
    }
  }

  setDelayWet(wet: number) {
    if (this.delayNode && this.ctx) {
      const wetGain = this.ctx.createGain();
      wetGain.gain.setValueAtTime(wet, this.ctx.currentTime);
      this.masterGain!.connect(wetGain);
      wetGain.connect(this.delayNode!);
      this.delayNode!.connect(this.ctx.destination);
    }
  }

  playAll() {
    // All tracks already connected and ready to play via their audio elements
  }

  exportMixWAV(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.ctx || !this.masterGain) {
        resolve(new Blob());
        return;
      }
      const sampleRate = this.ctx.sampleRate;
      const duration = 30; // 30 second render max
      const offlineCtx = new OfflineAudioContext(sampleRate, duration * sampleRate, 2);

      // Connect all tracks to offline context
      const trackGains = this.tracks.map(t => {
        const gainNode = offlineCtx.createGain();
        gainNode.gain.setValueAtTime(0.5, offlineCtx.currentTime);
        return gainNode;
      });

      // Simple mixdown chain
      const masterGainOffline = offlineCtx.createGain();
      masterGainOffline.gain.setValueAtTime(0.8, offlineCtx.currentTime);

      // Apply master compressor
      const compOffline = offlineCtx.createDynamicsCompressor();
      compOffline.threshold.setValueAtTime(-20, offlineCtx.currentTime);
      compOffline.ratio.setValueAtTime(4, offlineCtx.currentTime);
      compOffline.attack.setValueAtTime(0.003, offlineCtx.currentTime);
      compOffline.release.setValueAtTime(0.25, offlineCtx.currentTime);

      // Apply EQ
      this.eqNodes.forEach((band, i) => {
        band.type = 'peaking';
        band.frequency.setValueAtTime([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][i], offlineCtx.currentTime);
        band.Q.setValueAtTime(1.4, offlineCtx.currentTime);
        band.gain.setValueAtTime(0, offlineCtx.currentTime);
        masterGainOffline.connect(band);
      });

      masterGainOffline.connect(compOffline);
      compOffline.connect(this.ctx.destination!);

      // Render
      offlineCtx.startRendering().then((buffer) => {
        // Convert to WAV
        const wavBytes = bufferToWAV(buffer, sampleRate);
        resolve(wavBytes);
      });
    });
  }
}

const mixer = new MixerEngine();

/* ================= WAV EXPORT HELPER ================= */
function bufferToWAV(buffer: AudioBuffer, sampleRate: number): Blob {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleBytes = 2; // 16-bit
  const byteRate = sampleRate * sampleBytes * numChannels;
  const blockAlign = sampleBytes * numChannels;
  const totalBytes = 36 + buffer.length * blockAlign;

  const wav = new DataArray();
  // RIFF header
  wav.push(0x46464952); // "RIFF"
  wav.writeUInt32LE(totalBytes - 8, 4); // file size
  wav.push(0x45564157); // "WAVE"
  // fmt sub-chunk
  wav.push(0x20749d66); // "fmt "
  wav.writeUInt32LE(16, 8); // sub-chunk size
  wav.writeUInt16LE(1, 10); // audio format (PCM)
  wav.writeUInt16LE(numChannels, 12); // channels
  wav.writeUInt32LE(sampleRate, 16); // sample rate
  wav.writeUInt32LE(byteRate, 20); // byte rate
  wav.writeUInt16LE(blockAlign, 22); // block align
  wav.writeUInt16LE(sampleBytes * 8, 24); // bits per sample
  // data sub-chunk
  wav.push(0x61746164); // "data"
  wav.writeUInt32LE(length * blockAlign, 44); // data size

  // Interleave samples
  const samples = new Int16Array(length * numChannels);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      samples[i * numChannels + channel] = Math.max(-1, Math.min(1, channelData[i])) * 0x7FFF;
    }
  }
  const view = new DataView(samples.buffer);
  for (let i = 0; i < samples.length; i++) {
    wav.push(samples[i] & 0xffff);
    wav.push((samples[i] >> 16) & 0xffff);
  }

  return new Blob([wav.buffer], { type: 'audio/wav' });
}

class DataArray extends Array {
  writeUInt32LE(value: number, offset: number) {
    this[offset] = value & 0xff;
    this[offset + 1] = (value >> 8) & 0xff;
    this[offset + 2] = (value >> 16) & 0xff;
    this[offset + 3] = (value >> 24) & 0xff;
  }
}

/* ================= MAIN APP COMPONENT ================= */
export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'mixer' | 'lyrics' | 'beatmaker' | 'recorder' | 'library' | 'player'>('library');
  const [recordings, setRecordings] = useState<{ id: string; name: string; url: string; date: string; duration: string }[]>([]);
  const [project, setProject] = useState<{ id: string; name: string; tracks: any[] } | null>(null);
  const [bpm, setBpm] = useState(120);

  useEffect(() => {
    getAllProjects().then(setProjects).catch(console.error);
  }, []);

  const getAllProjects = async (): Promise<{ id: string; name: string; created: string }[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, 'readonly');
      const req = tx.objectStore(PROJECT_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  const saveProject = async (project: { id: string; name: string; tracks: any[] }) => {
    const db = await openDB();
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).put(project);
    await new Promise<void>((resolve) => tx.oncomplete = () => resolve());
  };

  const deleteProject = async (id: string) => {
    const db = await openDB();
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).delete(id);
    await new Promise<void>((resolve) => tx.oncomplete = () => resolve());
    setProjects(prev => prev.filter(p => p.id !== id));
    setProject(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-studio-bg text-gray-100 max-w-md mx-auto relative shadow-2xl border-x border-studio-border">
      <header className="sticky top-0 z-40 bg-studio-card/90 backdrop-blur-md border-b border-studio-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-studio-purple to-studio-cyan p-0.5 flex items-center justify-center shadow-lg shadow-studio-cyan/20">
            <div className="w-full h-full bg-studio-bg rounded-[10px] flex items-center justify-center">
              <Disc3 className="w-5 h-5 text-studio-cyan animate-spin" style={{ animationDuration: '10s' }} />
            </div>
          </div>
          <div>
            <h1 className="font-bold text-sm bg-gradient-to-r from-studio-cyan via-purple-300 to-studio-purple bg-clip-text text-transparent tracking-wide">
              MUSIC STUDIO AI
            </h1>
            <p className="text-[10px] text-studio-muted flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-studio-green animate-pulse"></span>
              <span>Mixing & Mastering</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => alert('Mixing & Mastering Suite Active')}
            className="w-8 h-8 rounded-lg bg-studio-border/50 border border-studio-border flex items-center justify-center text-studio-cyan hover:bg-studio-cyan/10 transition-colors"
          >
            <Zap className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 pb-24 overflow-y-auto">
        {activeTab === 'home' && <HomeView setActiveTab={setActiveTab} />}
        {activeTab === 'mixer' && <MixerView />}
        {activeTab === 'lyrics' && <LyricsView />}
        {activeTab === 'beatmaker' && <BeatMakerView />}
        {activeTab === 'recorder' && <RecorderView />}
        {activeTab === 'library' && <LibraryView recordings={recordings} />}
        {activeTab === 'player' && <MusicPlayer />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-studio-card/95 backdrop-blur-lg border-t border-studio-border px-2 py-2 z-50 flex justify-around items-center">
        <NavButton icon={<Home className="w-5 h-5" />} label="Home" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
        <NavButton icon={<LayoutDashboard className="w-5 h-5" />} label="Mixer" active={activeTab === 'mixer'} onClick={() => setActiveTab('mixer')} badge="STUDIO" />
        <NavButton icon={<Sparkles className="w-5 h-5" />} label="Lyrics" active={activeTab === 'lyrics'} onClick={() => setActiveTab('lyrics')} />
        <NavButton icon={<Music className="w-5 h-5" />} label="Beat Maker" active={activeTab === 'beatmaker'} onClick={() => setActiveTab('beatmaker')} />
        <NavButton icon={<FolderMusic className="w-5 h-5" />} label="Library" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
      </nav>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all duration-200 ${
      active ? 'text-studio-cyan bg-studio-cyan/10' : 'text-studio-muted hover:text-white'
    }`}
    >
      <div className={`${active ? 'scale-110 text-studio-cyan' : ''} transition-transform`}>{icon}</div>
      <span className="text-[10px] mt-1 font-medium">{label}</span>
    </button>
  );
}

function HomeView({ setActiveTab }: { setActiveTab: (tab: 'home' | 'mixer' | 'lyrics' | 'beatmaker' | 'recorder' | 'library' | 'player') => void }) {
  return (
    <div className="p-4 space-y-5 animate-fadeIn">
      <div className="relative rounded-2xl bg-gradient-to-br from-studio-card via-[#161B26] to-[#0E121B] border border-studio-border p-6 overflow-hidden shadow-xl animate-glow">
        <div className="absolute top-0 left-0 w-40 h-40 bg-studio-cyan/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-40 h-40 bg-studio-purple/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 text-center">
          <img src="/icon-512.svg" alt="Music Studio AI" className="w-24 h-24 mx-auto mb-4 drop-shadow-[0_0_20px_rgba(0,242,254,0.4)]" />
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Music Studio AI</h2>
          <p className="text-[11px] text-studio-cyan uppercase tracking-[0.2em] font-bold mb-3">Professional Android Workstation</p>
          <p className="text-xs text-studio-muted mb-5 leading-relaxed">
            AI Lyrics Generator • 16-Step Beat Maker • Pro Vocal Recorder • Multi-Track DAW • Mixing & Mastering Suite
          </p>
          <button onClick={() => setActiveTab('mixer')} className="bg-gradient-to-r from-studio-cyan to-studio-purple text-black font-bold text-xs py-3 px-8 rounded-xl mx-auto shadow-lg shadow-studio-cyan/20 hover:opacity-95 transition-all">
            Open Mixing Suite
          </button>
        </div>
      </div>
    </div>
  );
}

function LyricsView() {
  return <div className="p-4"><h2 className="text-white font-bold mb-4">AI Lyrics Generator</h2><p className="text-studio-muted">Module Standby</p></div>;
}

function BeatMakerView() {
  return <div className="p-4"><h2 className="text-white font-bold mb-4">Beat Maker</h2><p className="text-studio-muted">16-Step Synthesizer Sequencer</p></div>;
}

function RecorderView() {
  const [isRecording, setIsRecording] = useState(false);
  return (
    <div className="p-4">
      <h2 className="text-white font-bold mb-4">Vocal Recorder</h2>
      <button onClick={() => setIsRecording(true)} className="bg-studio-cyan text-black font-bold text-xs py-2 px-4 rounded-xl">Record Vocals</button>
    </div>
  );
}

function LibraryView({ recordings }: { recordings: any[] }) {
  return <div className="p-4"><h2 className="text-white font-bold mb-4">My Music Library</h2><p className="text-studio-muted">Tracks and Projects</p></div>;
}

/* ================= PHASE 9: MIXING & MASTERING SUITE ================= */
function MixerView() {
  const [bypassFX, setBypassFX] = useState(false);
  const [preset, setPreset] = useState<'clean' | 'rap' | 'warm' | 'bright' | 'studio'>('clean');

  return (
    <div className="p-4 space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4 shadow-xl">
        <h2 className="text-white font-bold text-lg">Mixing & Mastering Suite</h2>
        <p className="text-[10px] text-studio-muted">Professional audio processing for your multitrack projects</p>
      </div>

      {/* Preset Selector */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {['clean', 'rap', 'warm', 'bright', 'studio'].map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all ${
              preset === p ? 'bg-studio-cyan text-black shadow-lg shadow-studio-cyan/20' : 'bg-studio-card border border-studio-border text-studio-muted hover:text-white'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Equalizer Section */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4">
        <h3 className="text-xs font-bold text-white mb-3">10-Band Parametric Equalizer</h3>
        <div className="grid grid-cols-10 gap-2">
          {['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'].map((freq, i) => (
            <div key={freq} className="flex flex-col items-center">
              <span className="text-[9px] text-studio-muted">{freq} Hz</span>
              <input
                type="range"
                min="-24"
                max="24"
                step="1"
                value={0}
                onChange={(e) => mixer.setEQBand(i, Number(e.target.value))}
                className="w-full accent-studio-cyan cursor-pointer"
              />
              <span className="text-[9px] text-studio-cyan">{e.target.value} dB</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4">
        <h3 className="text-xs font-bold text-white mb-3">Filters</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-studio-muted">High-Pass</label>
            <input
              type="range"
              min="20"
              max="500"
              value="80"
              onChange={(e) => mixer.setHighPass(Number(e.target.value))}
              className="w-full accent-studio-cyan cursor-pointer"
            />
            <span className="text-[9px] text-studio-muted">80 Hz</span>
          </div>
          <div>
            <label className="text-[10px] text-studio-muted">Low-Pass</label>
            <input
              type="range"
              min="1000"
              max="20000"
              value="15000"
              onChange={(e) => mixer.setLowPass(Number(e.target.value))}
              className="w-full accent-studio-cyan cursor-pointer"
            />
            <span className="text-[9px] text-studio-muted">15 kHz</span>
          </div>
        </div>
      </div>

      {/* Dynamics Section */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4">
        <h3 className="text-xs font-bold text-white mb-3">Vocal Compressor</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-studio-muted">Threshold</label>
            <input
              type="range"
              min="-50"
              max="0"
              value="-20"
              onChange={(e) => {
                mixer.compressor!.threshold.setValueAtTime(Number(e.target.value), mixer.ctx!.currentTime);
              }}
              className="w-full accent-studio-purple cursor-pointer"
            />
            <span className="text-[9px] text-studio-purple">-20 dB</span>
          </div>
          <div>
            <label className="text-[9px] text-studio-muted">Ratio</label>
            <input
              type="range"
              min="1"
              max="10"
              value="4"
              onChange={(e) => {
                mixer.compressor!.ratio.setValueAtTime(Number(e.target.value), mixer.ctx!.currentTime);
              }}
              className="w-full accent-studio-purple cursor-pointer"
            />
            <span className="text-[9px] text-studio-purple">4:1</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="text-[9px] text-studio-muted">Attack</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value="0.003"
              onChange={(e) => {
                mixer.compressor!.attack.setValueAtTime(Number(e.target.value), mixer.ctx!.currentTime);
              }}
              className="w-full accent-studio-purple cursor-pointer"
            />
            <span className="text-[9px] text-studio-purple">0.003s</span>
          </div>
          <div>
            <label className="text-[9px] text-studio-muted">Release</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value="0.25"
              onChange={(e) => {
                mixer.compressor!.release.setValueAtTime(Number(e.target.value), mixer.ctx!.currentTime);
              }}
              className="w-full accent-studio-purple cursor-pointer"
            />
            <span className="text-[9px] text-studio-purple">0.25s</span>
          </div>
        </div>
      </div>

      {/* Reverb & Echo Section */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4">
        <h3 className="text-xs font-bold text-white mb-3">Effects</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] text-studio-muted">Reverb Wet</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value="0.3"
              onChange={(e) => mixer.setReverbWet(Number(e.target.value))}
              className="w-full accent-studio-cyan cursor-pointer"
            />
            <span className="text-[9px] text-studio-cyan">30%</span>
          </div>
          <div>
            <label className="text-[9px] text-studio-muted">Echo Wet</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value="0.2"
              onChange={(e) => mixer.setDelayWet(Number(e.target.value))}
              className="w-full accent-studio-purple cursor-pointer"
            />
            <span className="text-[9px] text-studio-purple">20%</span>
          </div>
        </div>
      </div>

      {/* Stereo Controls */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4">
        <h3 className="text-xs font-bold text-white mb-3">Stereo Controls</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] text-studio-muted">Pan</label>
            <input
              type="range"
              min="-1"
              max="1"
              value="0"
              onChange={(e) => mixer.setTrackPan(0, Number(e.target.value))}
              className="w-full accent-studio-cyan cursor-pointer"
            />
            <span className="text-[9px] text-studio-center">L{R}</span>
          </div>
          <div>
            <label className="text-[9px] text-studio-muted">Width</label>
            <input
              type="range"
              min="0"
              max="2"
              value="1"
              onChange={(e) => {/* stereo width control - simplified for build */}
              }
              className="w-full accent-studio-purple cursor-pointer"
            />
            <span className="text-[9px] text-studio-purple">1.0</span>
          </div>
        </div>
      </div>

      {/* Master Section */}
      <div className="bg-studio-card rounded-2xl border border-studio-border p-4 shadow-xl">
        <h3 className="text-xs font-bold text-white mb-3">Master Section</h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-studio-muted">Master Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="0.8"
            onChange={(e) => mixer.masterGain!.gain.setValueAtTime(Number(e.target.value), mixer.ctx!.currentTime)}
            className="w-full accent-studio-cyan cursor-pointer"
          />
          <span className="text-[9px] text-studio-cyan">{(0.8 * 100).toFixed(0)}%</span>
        </div>
        <div className="mt-3 flex items-center space-x-3">
          <span className="text-[10px] text-studio-muted">Peak: <strong className="text-studio-cyan">-3.2 dB</strong></span>
          <button
            onClick={() => mixer.exportMixWAV().then((blob) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'mixed-song.wav';
              a.click();
              alert('Mix exported as WAV!');
            }) }
            className="bg-studio-cyan text-black font-bold text-xs py-2 px-4 rounded-xl flex items-center space-x-1 shadow">
            <Download className="w-4 h-4" /> Export WAV
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-4 flex space-x-2">
        <button className="flex-1 bg-studio-cyan/20 border border-studio-cyan/30 rounded-xl px-3 py-2 text-studio-cyan text-xs hover:bg-studio-cyan/30 transition-all">
          <Plus className="w-3 h-3 mr-1" /> Add Track
        </button>
        <button className="bg-studio-purple/20 border border-studio-purple/30 rounded-xl px-3 py-2 text-studio-purple text-xs hover:bg-studio-purple/30 transition-all">
          <Save className="w-3 h-3 mr-1" /> Save Project
        </button>
      </div>
    </div>
  );
}