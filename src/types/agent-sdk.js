// TypeScript models mirroring agent-server (agent-sdk) wire format
// Event-level guard
export const isEvent = (e) => {
    if (!e || typeof e !== 'object' || typeof e.type !== 'string')
        return false;
    const t = e.type;
    if (t === 'message')
        return !!e.message && typeof e.message === 'object' && Array.isArray(e.message.content);
    if (t === 'action')
        return !!e.action && typeof e.action.name === 'string';
    if (t === 'observation')
        return !!e.observation && typeof e.observation === 'object';
    if (t === 'system')
        return typeof e.message === 'string';
    if (t === 'error')
        return typeof e.error === 'string';
    return false;
};
// Content guards
export const isTextContent = (c) => c.type === 'text';
export const isImageContent = (c) => c.type === 'image';
// Event kind guards
export const isMessageEvent = (e) => e.type === 'message';
export const isActionEvent = (e) => e.type === 'action';
export const isObservationEvent = (e) => e.type === 'observation';
export const isSystemEvent = (e) => e.type === 'system';
export const isErrorEvent = (e) => e.type === 'error';
//# sourceMappingURL=agent-sdk.js.map