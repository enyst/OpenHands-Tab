import type { ProfileFormMode } from './formState';
import { Tooltip } from '../Tooltip';

export function LlmProfilesPanelHeader(props: {
  mode: ProfileFormMode;
  selectedProfileId: string | null;
  loadingProfile: boolean;
  saving: boolean;
  deleting: boolean;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const { mode, selectedProfileId, loadingProfile, saving, deleting, onCreate, onDuplicate, onDelete, onClose } = props;

  const duplicateDisabled = mode !== 'edit' || !selectedProfileId || loadingProfile;
  const deleteDisabled = mode !== 'edit' || !selectedProfileId || loadingProfile || saving || deleting;

  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
      <div className="flex items-center gap-2.5">
        <div className="text-2xl" aria-label="OpenHands">
          🙌
        </div>
        <h2 className="font-semibold text-base leading-tight text-stone-100">OpenHands - LLM Profiles</h2>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip content="Create profile" position="bottom">
          <button
            type="button"
            onClick={onCreate}
            className="h-9 w-9 rounded-lg bg-gradient-to-b from-brand-500/25 to-brand-600/20 text-brand-200 border border-brand-500/30 hover:from-brand-500/35 hover:to-brand-600/30 hover:border-brand-500/40 transition-all flex items-center justify-center"
            aria-label="Create profile"
          >
            <span className="codicon codicon-add" />
          </button>
        </Tooltip>
        <Tooltip content="Duplicate profile" position="bottom">
          <button
            type="button"
            onClick={onDuplicate}
            disabled={duplicateDisabled}
            className="h-9 w-9 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:text-stone-100 hover:bg-white/[0.08] transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Duplicate profile"
          >
            <span className="codicon codicon-copy" />
          </button>
        </Tooltip>
        <Tooltip content="Delete profile" position="bottom">
          <button
            type="button"
            onClick={() => { void onDelete(); }}
            disabled={deleteDisabled}
            className="h-9 w-9 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 hover:bg-red-500/15 hover:border-red-500/30 transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Delete profile"
          >
            <span className={`codicon codicon-${deleting ? 'loading' : 'trash'} ${deleting ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
        <Tooltip content="Close" position="bottom">
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:text-stone-100 hover:bg-white/[0.08] transition-all flex items-center justify-center"
            aria-label="Close profiles view"
          >
            <span className="codicon codicon-close" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
