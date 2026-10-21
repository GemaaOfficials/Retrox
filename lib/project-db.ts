export type FilterPreset = "none" | "cinema" | "mono" | "dream" | "neon" | "cultural-aura" | "lofi" | "vhs";
export type Rhythm = "steady" | "punchy" | "slow";
export type Aspect = "original" | "portrait" | "square" | "landscape";

export interface ProjectSettings {
  title: string;
  subtitle: string;
  volume: number;
  sourceVolume: number;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  aspect: Aspect;
  preset: FilterPreset;
  rhythm: Rhythm;
  animatedTitles: boolean;
  useQuickCuts: boolean;
}
export interface SavedProject {
  id: string;
  updatedAt: number;
  settings: ProjectSettings;
  videoBlob?: Blob;
  videoName?: string;
  audioBlob?: Blob;
  audioName?: string;
}
type ProjectRecord = Omit<SavedProject, "videoBlob" | "audioBlob"> & {
  videoSignature?: string;
  audioSignature?: string;
};
type MediaRecord = { signature: string; blob: Blob };

const DB_NAME = "reeditx-studio";
const DB_VERSION = 2;
const PROJECTS = "projects";
const MEDIA = "media";

function signature(blob: Blob | undefined, name: string | undefined): string | undefined {
  if (!blob) return undefined;
  const modified = "lastModified" in blob ? String((blob as File).lastModified) : "";
  return [name ?? "", blob.type, blob.size, modified].join("|");
}

function openDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
      // Migrate any project saved by the first browser-only prototype without losing its media.
      if (tx && event.oldVersion < 2) {
        const store = tx.objectStore(PROJECTS);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const value = item.value as SavedProject;
          if (value.videoBlob) {
            const videoSignature = signature(value.videoBlob, value.videoName);
            if (videoSignature) tx.objectStore(MEDIA).put({ blob: value.videoBlob, signature: videoSignature } satisfies MediaRecord, value.id + ":video");
          }
          if (value.audioBlob) {
            const audioSignature = signature(value.audioBlob, value.audioName);
            if (audioSignature) tx.objectStore(MEDIA).put({ blob: value.audioBlob, signature: audioSignature } satisfies MediaRecord, value.id + ":audio");
          }
          const { videoBlob: _videoBlob, audioBlob: _audioBlob, ...metadata } = value;
          item.update(metadata);
          item.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local project storage."));
  });
}

export async function saveProject(project: SavedProject): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECTS, MEDIA], "readwrite");
      const projectStore = tx.objectStore(PROJECTS);
      const mediaStore = tx.objectStore(MEDIA);
      const { videoBlob, audioBlob, ...metadata } = project;
      projectStore.put({
        ...metadata,
        videoSignature: signature(videoBlob, project.videoName),
        audioSignature: signature(audioBlob, project.audioName),
        updatedAt: Date.now(),
      } satisfies ProjectRecord);

      const persistMedia = (key: string, blob: Blob | undefined, name: string | undefined) => {
        const nextSignature = signature(blob, name);
        if (!blob || !nextSignature) {
          mediaStore.delete(key);
          return;
        }
        const lookup = mediaStore.get(key);
        lookup.onsuccess = () => {
          const current = lookup.result as MediaRecord | undefined;
          // Slider changes update lightweight project metadata, not the stored video bytes.
          if (current?.signature !== nextSignature) mediaStore.put({ blob, signature: nextSignature } satisfies MediaRecord, key);
        };
      };
      persistMedia(project.id + ":video", videoBlob, project.videoName);
      persistMedia(project.id + ":audio", audioBlob, project.audioName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Project autosave failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Project autosave was cancelled."));
    });
  } finally {
    db.close();
  }
}

export async function loadProject(id = "latest"): Promise<SavedProject | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS, MEDIA], "readonly");
      const projectRequest = tx.objectStore(PROJECTS).get(id);
      const mediaStore = tx.objectStore(MEDIA);
      projectRequest.onsuccess = () => {
        const record = projectRequest.result as ProjectRecord | undefined;
        if (!record) { resolve(null); return; }
        const videoRequest = mediaStore.get(id + ":video");
        const audioRequest = mediaStore.get(id + ":audio");
        const assemble = () => {
          if (videoRequest.readyState !== "done" || audioRequest.readyState !== "done") return;
          const video = videoRequest.result as MediaRecord | undefined;
          const audio = audioRequest.result as MediaRecord | undefined;
          const { videoSignature: _videoSignature, audioSignature: _audioSignature, ...metadata } = record;
          resolve({ ...metadata, videoBlob: video?.blob, audioBlob: audio?.blob } as SavedProject);
        };
        videoRequest.onsuccess = assemble;
        audioRequest.onsuccess = assemble;
      };
      projectRequest.onerror = () => reject(projectRequest.error ?? new Error("Could not restore project."));
      tx.onerror = () => reject(tx.error ?? new Error("Could not read saved project."));
    });
  } finally {
    db.close();
  }
}

export async function clearProject(id = "latest"): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECTS, MEDIA], "readwrite");
      tx.objectStore(PROJECTS).delete(id);
      tx.objectStore(MEDIA).delete(id + ":video");
      tx.objectStore(MEDIA).delete(id + ":audio");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not remove project."));
    });
  } finally {
    db.close();
  }
}
