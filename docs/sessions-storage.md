# Sessions & storage

## Purpose

Persist transcripts on the local browser origin so users can reopen, export, or delete notes without a server.

## History panel (main page aside)

| Element | Behavior |
|---|---|
| Header | “Saved locally” + IndexedDB reminder |
| Empty state | “No saved sessions yet.” |
| Session row | Title (preview of text) + last updated time |
| **Open** | Loads that session into the composer (stops active capture) |
| **Export** | Downloads that session as a `.txt` file |
| **Delete** | Removes from IndexedDB; if it was active, starts a blank session |

Active session is visually highlighted.

## Session model

Stored object (`TranscriptSession`):

| Field | Meaning |
|---|---|
| `id` | UUID |
| `title` | First ~48 characters of text, or “Untitled session” |
| `text` | Full transcript body |
| `createdAt` | Epoch ms |
| `updatedAt` | Epoch ms (bumped on edits) |

## Persistence behavior

| Action | Result |
|---|---|
| Text appended from recognition | Debounced save (~400ms) to IndexedDB |
| **New** | Saves current non-empty session, then blank session |
| **Export** (active) | Ensures save, then downloads `dictation-YYYY-MM-DD-….txt` |
| **Copy** | Clipboard only; does not create a new DB row by itself |
| Clear site data | Wipes IndexedDB sessions for this origin |

Database: IndexedDB name `dictation`, object store `sessions`, index on `updatedAt`.

## Export format

Plain UTF-8 text of `session.text` only (no metadata wrapper).

## Implementation

- Module: `storage.ts`  
- APIs: `listSessions`, `getSession`, `saveSession`, `deleteSession`, `createSession`, `exportSessionAsText`  
