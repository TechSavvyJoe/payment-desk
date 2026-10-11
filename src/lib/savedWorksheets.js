import { DESK_DRAFT_VERSION, normalizeDeskDraft } from './deskDraft.js';

export const SAVED_WORKSHEETS_KEY = 'payment-desk.worksheets.v1';
export const SAVED_WORKSHEETS_LOCK_KEY = SAVED_WORKSHEETS_KEY;
export const SAVED_WORKSHEETS_VERSION = 1;
export const MAX_SAVED_WORKSHEETS = 50;
export const MAX_WORKSHEET_NAME_LENGTH = 80;
export const MAX_WORKSHEET_SNAPSHOT_LENGTH = 200_000;
export const MAX_WORKSHEET_COLLECTION_LENGTH = 1_000_000;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const keysOnly = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const success = value => ({ ok: true, value });
const messages = {
  conflict: 'Another tab changed the saved worksheets. Reload the list before trying again; your open worksheet is unchanged.',
  rejected: 'Saved worksheets could not be read. Their data has been preserved. Use a compatible app version before changing them.',
  error: 'Saved worksheets could not be stored or read on this device. Your open worksheet and previous saved copies have been kept.',
  invalid: 'The worksheet operation is invalid. No saved worksheets were changed.',
};
const failure = (reason, status = 'invalid') => ({ ok: false, status, reason, message: messages[status] });

export function normalizeWorksheetName(value) {
  if (typeof value !== 'string') return failure('invalid-name');
  const name = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return name && [...name].length <= MAX_WORKSHEET_NAME_LENGTH ? success(name) : failure('invalid-name');
}

/** Captures only persisted inputs, excluding fees, branding, totals, UI and Undo. */
export function captureWorksheetSnapshot(value) {
  if (!object(value)) return failure('invalid-snapshot');
  const version = value.version === undefined ? DESK_DRAFT_VERSION : value.version;
  if (![1, 2, DESK_DRAFT_VERSION].includes(version)) return failure('unsupported-snapshot-version');
  if (!object(value.desk) || !object(value.desk.deal) || !object(value.desk.gridRates)
    || !object(value.targetValues) || !object(value.inputDrafts)
    || !Object.values(value.inputDrafts).every(object)) return failure('invalid-snapshot');
  const normalized = normalizeDeskDraft({ ...value, version });
  if (!normalized) return failure('invalid-snapshot');
  const { deal, gridRates, gridDownPayments, startDate, dateChosen, nextItemId } = normalized.desk;
  const snapshot = { version: DESK_DRAFT_VERSION,
    desk: { deal, gridRates, gridDownPayments, startDate, dateChosen, nextItemId },
    targetType: normalized.targetType, targetValues: normalized.targetValues, inputDrafts: normalized.inputDrafts };
  return JSON.stringify(snapshot).length <= MAX_WORKSHEET_SNAPSHOT_LENGTH ? success(snapshot) : failure('snapshot-too-large');
}

function normalizeCollection(value) {
  if (!object(value) || value.version !== SAVED_WORKSHEETS_VERSION) return failure('unsupported-version');
  if (!keysOnly(value, ['version', 'revision', 'worksheets']) || !uuid(value.revision)
    || !Array.isArray(value.worksheets)) return failure('invalid-fields');
  if (value.worksheets.length > MAX_SAVED_WORKSHEETS) return failure('too-many-worksheets');
  const worksheets = [], ids = new Set();
  for (const entry of value.worksheets) {
    if (!object(entry) || !keysOnly(entry, ['id', 'name', 'createdAt', 'updatedAt', 'snapshot'])
      || !uuid(entry.id) || ids.has(entry.id) || !timestamp(entry.createdAt) || !timestamp(entry.updatedAt)
      || entry.updatedAt < entry.createdAt || !object(entry.snapshot)
      || !Number.isInteger(entry.snapshot.version)) return failure('invalid-fields');
    const name = normalizeWorksheetName(entry.name), snapshot = captureWorksheetSnapshot(entry.snapshot);
    if (!name.ok) return name;
    if (!snapshot.ok) return snapshot;
    ids.add(entry.id);
    worksheets.push({ id: entry.id, name: name.value, createdAt: entry.createdAt, updatedAt: entry.updatedAt, snapshot: snapshot.value });
  }
  return success({ version: SAVED_WORKSHEETS_VERSION, revision: value.revision, worksheets });
}

export function encodeWorksheetCollection(value) {
  const normalized = normalizeCollection(value);
  if (!normalized.ok) return normalized;
  const raw = JSON.stringify(normalized.value);
  return raw.length <= MAX_WORKSHEET_COLLECTION_LENGTH ? success(raw) : failure('collection-too-large');
}

/** null means no record; rejected records must never be overwritten. */
export function decodeWorksheetCollection(raw) {
  if (raw === null) return { kind: 'absent', collection: null };
  const reject = reason => ({ kind: 'rejected', collection: null, ...failure(reason, 'rejected') });
  if (typeof raw !== 'string') return reject('invalid-fields');
  if (raw.length > MAX_WORKSHEET_COLLECTION_LENGTH) return reject('collection-too-large');
  let value;
  try { value = JSON.parse(raw); } catch { return reject('malformed-json'); }
  const result = normalizeCollection(value);
  return result.ok ? { kind: 'valid', collection: result.value } : reject(result.reason);
}

/** Pure commands require caller-supplied UUIDs and ISO times; null is an empty collection. */
export function applyWorksheetCommand(collection, command, { revision, now } = {}) {
  if (!uuid(revision) || !timestamp(now)) return failure('invalid-metadata');
  const base = collection === null ? success({ version: SAVED_WORKSHEETS_VERSION, revision, worksheets: [] }) : normalizeCollection(collection);
  if (!base.ok) return base;
  if (collection && revision === collection.revision) return failure('unchanged-revision');
  if (!object(command) || !['create', 'replace', 'rename', 'delete'].includes(command.type)) return failure('invalid-command');
  if (!uuid(command.id)) return failure('invalid-id');
  const next = base.value;
  const index = next.worksheets.findIndex(entry => entry.id === command.id);
  if (command.type === 'create') {
    if (index !== -1) return failure('duplicate-id');
    if (next.worksheets.length >= MAX_SAVED_WORKSHEETS) return failure('too-many-worksheets');
    const name = normalizeWorksheetName(command.name), snapshot = captureWorksheetSnapshot(command.snapshot);
    if (!name.ok) return name;
    if (!snapshot.ok) return snapshot;
    next.worksheets.push({ id: command.id, name: name.value, createdAt: now, updatedAt: now, snapshot: snapshot.value });
  } else {
    if (index === -1) return failure('not-found');
    const entry = next.worksheets[index];
    // A clock adjustment must not move an existing worksheet's timestamp backwards.
    const updatedAt = now < entry.updatedAt ? entry.updatedAt : now;
    if (command.type === 'delete') next.worksheets.splice(index, 1);
    if (command.type === 'rename') {
      const name = normalizeWorksheetName(command.name);
      if (!name.ok) return name;
      next.worksheets[index] = { ...entry, name: name.value, updatedAt };
    }
    if (command.type === 'replace') {
      const snapshot = captureWorksheetSnapshot(command.snapshot);
      if (!snapshot.ok) return snapshot;
      next.worksheets[index] = { ...entry, snapshot: snapshot.value, updatedAt };
    }
  }
  next.revision = revision;
  const encoded = encodeWorksheetCollection(next);
  return encoded.ok ? success(next) : encoded;
}

/** Returns fresh runtime state; main owns reducer replacement/remount and validation. */
export function prepareWorksheetRestore(collection, id) {
  const result = normalizeCollection(collection);
  if (!result.ok) return result;
  const entry = result.value.worksheets.find(worksheet => worksheet.id === id);
  if (!entry) return failure('not-found');
  const { desk, targetType, targetValues, inputDrafts } = normalizeDeskDraft(entry.snapshot);
  return success({ desk, targetType, targetValues, inputDrafts });
}

const deviceStorage = () => { try { return window.localStorage; } catch { return null; } };
const deviceLocks = () => { try { return navigator.locks; } catch { return null; } };

/**
 * read/reload -> {ok:true,value:{collection,worksheets:[metadata]}} or structured failure.
 * execute accepts the pure commands above; create may omit id. It generates metadata.
 * prepareRestore(id) returns the pure restore result, after checking for external changes.
 * Only reload adopts external changes or retries a denied read. No implicit overwrite.
 */
export function createSavedWorksheetSession(storage = deviceStorage(), locks = deviceLocks()) {
  const readRecord = () => {
    try {
      if (!storage) return { kind: 'error', ...failure('storage-unavailable', 'error') };
      const raw = storage.getItem(SAVED_WORKSHEETS_KEY);
      return { ...decodeWorksheetCollection(raw), raw };
    } catch { return { kind: 'error', ...failure('storage-unavailable', 'error') }; }
  };
  let record = readRecord(), conflicted = false;
  const check = () => {
    if (conflicted) return failure('changed-record', 'conflict');
    if (record.kind === 'error') return failure(record.reason, 'error');
    const current = readRecord();
    if (current.kind === 'error') { record = current; return failure(current.reason, 'error'); }
    if (current.raw !== record.raw) { conflicted = true; return failure('changed-record', 'conflict'); }
    if (current.kind === 'rejected') return failure(current.reason, 'rejected');
    return success(current.collection);
  };
  const read = () => {
    const result = check();
    return result.ok ? success({ collection: result.value,
      worksheets: (result.value?.worksheets ?? []).map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })) }) : result;
  };
  return {
    read,
    reload: () => { record = readRecord(); conflicted = false; return read(); },
    prepareRestore: id => {
      const result = check();
      return result.ok ? (result.value ? prepareWorksheetRestore(result.value, id) : failure('not-found')) : result;
    },
    execute: async command => {
      // Clone before waiting for a lock so caller edits cannot change a queued command.
      let captured;
      try { captured = structuredClone(command); } catch { return failure('invalid-command'); }
      if (!locks?.request) return failure('locks-unavailable', 'error');
      try {
        return await locks.request(SAVED_WORKSHEETS_LOCK_KEY, () => {
          const current = check();
          if (!current.ok) return current;
          const id = captured?.type === 'create' && captured.id === undefined ? crypto.randomUUID() : captured?.id;
          const revision = crypto.randomUUID(), now = new Date().toISOString();
          const next = applyWorksheetCommand(current.value, { ...captured, id }, { revision, now });
          if (!next.ok) return next;
          const encoded = encodeWorksheetCollection(next.value);
          if (!encoded.ok) return encoded;
          try { storage.setItem(SAVED_WORKSHEETS_KEY, encoded.value); }
          catch (error) { return failure(error?.name === 'QuotaExceededError' ? 'storage-full' : 'storage-write-failed', 'error'); }
          // Advance only after success, retaining a revisioned empty collection on final delete.
          record = { kind: 'valid', collection: next.value, raw: encoded.value };
          return success(next.value);
        });
      } catch { return failure('lock-or-metadata-unavailable', 'error'); }
    },
  };
}
