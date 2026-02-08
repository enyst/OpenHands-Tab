export type FileEditorContent = { type: 'text'; text: string } | { type: 'image'; image_urls?: string[]; detail?: string };

export interface FileEditorResult {
  command: 'view' | 'create' | 'str_replace' | 'insert' | 'undo_edit';
  path?: string;
  prev_exist?: boolean;
  old_content?: string | null;
  new_content?: string | null;
  content?: FileEditorContent[];
}

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BASE64_CHARS = 4 * 1024 * 1024;
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
export const PDF_EXTENSION = '.pdf';
export const MAX_OUTPUT_CHARS = 50_000;
export const OUTPUT_CLIP_MARKER = '<response clipped>';
