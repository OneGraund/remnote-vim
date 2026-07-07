import {
  AppEvents,
  MoveUnit,
  RNPlugin,
  RichTextInterface,
  SelectionType,
} from '@remnote/plugin-sdk';
import { handleKey, initialState } from '../engine/engine';
import { Action, Mode, Snapshot, VimState } from '../engine/types';
import { hostDocument, readDomCaret, setDomCaret } from './domCaret';
import { bindingsForMode, SPEC_TO_SYM } from './keymap';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Infer the caret position after `pre` changed into `fresh`: find the common
 * prefix/suffix and put the caret at the end of the changed region (which is
 * where typing/deleting leaves it). If nothing changed, keep `fallback`.
 */
export function diffCaret(pre: string, fresh: string, fallback: number): number {
  if (pre === fresh) return clamp(fallback, 0, fresh.length);
  let p = 0;
  const maxP = Math.min(pre.length, fresh.length);
  while (p < maxP && pre[p] === fresh[p]) p++;
  let s = 0;
  const maxS = Math.min(pre.length - p, fresh.length - p);
  while (s < maxS && pre[pre.length - 1 - s] === fresh[fresh.length - 1 - s]) s++;
  return clamp(fresh.length - s, 0, fresh.length);
}

/** A register entry: one bullet's rich text plus its whole subtree. */
interface RegisterNode {
  text: RichTextInterface;
  children: RegisterNode[];
}

const MODE_COLORS: Record<Mode, string> = {
  normal: '#7c3aed',
  insert: '#059669',
  visual: '#d97706',
  'visual-line': '#d97706',
  command: '#0ea5e9',
};

const MODE_LABELS: Record<Mode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'V-LINE',
  command: 'COMMAND',
};

export class VimAdapter {
  private state: VimState = initialState();
  private queue: Promise<unknown> = Promise.resolve();
  private stolenSpecs = new Set<string>();
  /** Line register: cut/yanked bullets INCLUDING their subtrees. */
  private lineRegister: RegisterNode[] = [];
  private enabled = false;
  /** True while we are applying our own edits (so we ignore our own events). */
  private processing = false;
  /** Fallback caret when the editor reports no selection. */
  private lastCaret = 0;
  // debug/instrumentation
  private pluginId = '(none)';
  // Lightweight instrumentation: rx (keys received) and done (keys fully
  // processed) let the e2e harness wait for the plugin's queue to drain.
  private dbgCount = 0;
  private dbgDone = 0;
  private dbgLast = '-';
  /** Line text at the moment insert mode was entered (for caret diffing). */
  private insertEntryText: string | null = null;
  /** Visual-line selection: the trail of Rem ids the head has walked. */
  private vTrail: string[] | null = null;
  /** Rem ids currently highlighted (normalized trail) — rendered via CSS. */
  private vSelIds: string[] = [];
  /** Where the last dd / visual-line cut happened, for paste-after-cut. */
  private lastCutSite: { parentId: string | null; pos: number } | null = null;
  /** Debug trace of the last visual-line operation (shown in the badge). */
  private dbgV = '';
  /** Debug: how the last clipboard write went (api/exec/cut/FAIL). */
  private dbgClip = '';
  /**
   * Jumplist (Ctrl-O / Ctrl-I): rem ids recorded when a jump command leaves a
   * position. `jumpPos === jumps.length` means "at the live end" (not
   * currently browsing the list) — vim's model.
   */
  private jumps: string[] = [];
  private jumpPos = 0;

  constructor(private plugin: RNPlugin) {}

  get mode(): Mode {
    return this.state.mode;
  }

  async start(mode: Mode) {
    this.state.mode = mode;
    this.enabled = true;
    // RemNote fires StealKeyEvent with listenerKey = this plugin's id and
    // args = { key: <the is-hotkey spec that matched> }. Register a single
    // listener under the plugin id and translate the spec to an engine symbol.
    const pluginId = (this.plugin as unknown as { id?: string }).id;
    this.pluginId = pluginId ?? '(none)';
    const onSteal = (args: unknown) => {
      const spec = (args as { key?: string } | undefined)?.key;
      this.dbgCount++;
      this.dbgLast = String(spec);
      void this.render();
      if (!spec) return;
      const sym = SPEC_TO_SYM[spec] ?? (spec.length === 1 ? spec : undefined);
      if (sym == null) return;
      this.enqueue(sym);
    };
    // Register under the plugin id (the documented listenerKey) and also
    // under undefined, as a hedge against dispatch differences.
    this.plugin.event.addListener(AppEvents.StealKeyEvent, pluginId, onSteal);
    this.plugin.event.addListener(AppEvents.StealKeyEvent, undefined, onSteal);

    // Moving focus to a different Rem invalidates the local line model. (We
    // can't listen to EditorSelectionChanged for same-rem caret moves: our own
    // edits fire it asynchronously and would clobber the model we just built.
    // The snapshot's remId check handles cross-rem focus; a same-rem click is
    // reconciled on the next re-sync.)
    this.plugin.event.addListener(AppEvents.FocusedRemChange, undefined, () => {
      if (!this.processing) this.invalidateModel();
    });

    await this.applyMode(this.state.mode);
  }

  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      await this.plugin.app.releaseKeys([...this.stolenSpecs]);
      this.stolenSpecs.clear();
      await this.plugin.app.registerCSS('vim-mode', '');
      await this.plugin.app.toast('Vim mode off');
    } else {
      this.enabled = true;
      this.state = { ...initialState(), mode: 'normal' };
      await this.applyMode('normal');
      await this.plugin.app.toast('Vim mode on');
    }
  }

  /** Serialize key handling: keys can arrive faster than the async API runs. */
  private enqueue(sym: string) {
    this.queue = this.queue.then(() =>
      this.handleSym(sym).catch((e) => console.error('[vim] error handling', sym, e))
    );
  }

  private async handleSym(sym: string) {
    if (!this.enabled) {
      this.dbgDone++;
      return;
    }
    // Escape also dismisses the :help window (RemNote never sees the stolen
    // Escape, so we handle the close ourselves).
    if (sym === 'Escape' && this.helpWidgetId) {
      await this.closeHelp();
    }
    this.processing = true;
    try {
      const snap = await this.snapshot();
      const { state, actions } = handleKey(this.state, sym, snap);
      this.state = state;
      for (const a of actions) {
        // exec sees the pre-action model; update it afterwards so multi-action
        // commands still compose correctly.
        await this.exec(a, snap);
        this.updateModel(a);
      }
    } finally {
      this.processing = false;
    }
    this.dbgDone++;
    await this.render();
  }

  /**
   * The line the engine reasons about.
   *
   * RemNote's `getFocusedEditorText()` lags a keystroke or two behind the
   * actual editor after programmatic edits, so re-reading it every key makes
   * rapid command sequences (e.g. `dwA!`) compute offsets against stale text.
   * Instead we keep a local model, updated deterministically from the engine's
   * own actions (exactly like the unit-test harness), and only re-sync from
   * RemNote when the model is invalidated: focus moved, a structural/vertical
   * command ran, or the user typed natively in insert mode.
   */
  private model: { remId: string | undefined; text: string; caret: number } | null = null;

  private invalidateModel() {
    this.model = null;
  }

  /**
   * RemNote won't let a Rem's text begin with whitespace — it trims leading
   * spaces after every edit. Mirror that in the model (adjusting the caret) so
   * the engine's offsets keep matching what RemNote actually stores; otherwise
   * an operation that leaves a leading space (e.g. `de` on "world foo") drifts
   * the model one character and corrupts every later command.
   */
  private normalizeModel() {
    const m = this.model;
    if (!m) return;
    const trimmed = m.text.replace(/^\s+/, '');
    const removed = m.text.length - trimmed.length;
    if (removed > 0) {
      m.text = trimmed;
      m.caret = clamp(m.caret - removed, 0, trimmed.length);
    }
  }

  private async snapshot(): Promise<Snapshot> {
    // Trust the local model until it is explicitly invalidated (structural
    // command, leaving insert mode, or a FocusedRemChange event). Re-reading
    // RemNote here — or even calling getFocusedRem to compare ids — is flaky
    // under rapid key sequences and reintroduces the very staleness the model
    // exists to avoid.
    if (this.model) {
      return { text: this.model.text, caret: this.model.caret };
    }
    const focused = await this.plugin.focus.getFocusedRem();
    const remId = focused?._id;
    const rich = await this.plugin.editor.getFocusedEditorText();
    const text = rich ? (await this.plugin.richText.toString(rich)) ?? '' : '';
    let caret: number | null = null;
    const doc = hostDocument();
    if (doc) caret = readDomCaret(doc); // native: the real caret
    if (caret == null) {
      const sel = await this.plugin.editor.getSelection();
      caret =
        sel && sel.type === SelectionType.Text
          ? sel.isReverse
            ? sel.range.start
            : sel.range.end
          : this.lastCaret;
    }
    caret = clamp(caret, 0, text.length);
    this.model = { remId, text, caret };
    return { text, caret };
  }

  /** Keep the local model in step with an action we are about to execute. */
  private updateModel(a: Action) {
    if (!this.model) return;
    const m = this.model;
    switch (a.t) {
      case 'setCaret':
        m.caret = clamp(a.at, 0, m.text.length);
        break;
      case 'select':
        m.caret = clamp(a.end, 0, m.text.length);
        break;
      case 'deleteRange':
        m.text = m.text.slice(0, a.start) + m.text.slice(a.end);
        m.caret = clamp(a.start, 0, m.text.length);
        // keepLead deletes keep the editor's exact text (no whitespace
        // swallow in exec), so the model must not trim either.
        if (!a.keepLead) this.normalizeModel();
        break;
      case 'insertText':
        m.text = m.text.slice(0, a.at) + a.text + m.text.slice(a.at);
        m.caret = clamp(a.at + a.text.length, 0, m.text.length);
        this.normalizeModel();
        break;
      // Anything that changes the focused rem, its structure, or triggers
      // native typing invalidates the model — re-sync on the next snapshot.
      // (newBullet sets its own fresh model in exec, so it's not listed here.)
      case 'moveVertical':
      case 'deleteRem':
      case 'pasteRem':
      case 'goDoc':
      case 'indent':
      case 'outdent':
      case 'undo':
      case 'redo':
      case 'scroll':
      case 'runEx':
      case 'deleteRemSelection':
      case 'indentSelection':
      case 'outdentSelection':
      case 'clearRemSelection':
      case 'jump': // the caret lands in a different rem
      case 'focusPane':
      case 'vExtend': // the selection head physically moves the caret
        this.invalidateModel();
        break;
      case 'mode':
      case 'newBullet':
      case 'vStart':
      case 'yankRemSelection':
      case 'copyText':
        // newBullet installs its own model in exec; copyText's fallback path
        // maintains the model caret itself in exec; the others don't change
        // the focused line's text. Insert-mode exit is reconciled separately.
        break;
    }
  }

  // ------------------------------------------------------------ actions

  private async exec(a: Action, snap: Snapshot) {
    const { editor, rem, focus } = this.plugin;
    switch (a.t) {
      case 'setCaret': {
        // Move the REAL caret by a relative CHARACTER delta from the model's
        // pre-action position. (MoveUnit.LINE is a no-op in RemNote, but
        // CHARACTER deltas move the live cursor — this is what makes h/l/w/e/0
        // visible on screen.) exec runs before updateModel, so this.model still
        // holds the pre-action caret.
        const from = this.model?.caret ?? this.lastCaret;
        const to = clamp(a.at, 0, this.model?.text.length ?? a.at);
        const delta = to - from;
        if (delta !== 0) {
          await editor.moveCaret(delta, MoveUnit.CHARACTER);
        }
        this.lastCaret = to;
        break;
      }

      case 'select':
        await editor.selectText({ start: a.start, end: a.end });
        this.lastCaret = a.end;
        break;

      case 'deleteRange': {
        // If the deletion starts at column 0, extend it over any whitespace
        // that would become the new line start: RemNote's data layer trims
        // leading whitespace anyway (while the editor keeps it until later),
        // and deleting it ourselves keeps editor, data layer and model in sync.
        let end = a.end;
        const pre = this.model?.text ?? snap.text;
        if (a.start === 0 && !a.keepLead) {
          while (end < pre.length && /\s/.test(pre[end])) end++;
        }
        if (end > a.start) {
          await editor.selectText({ start: a.start, end });
          // Register-worthy deletes go through the editor's native CUT: same
          // edit, but the removed text also reaches the OS clipboard (vim
          // clipboard=unnamed). cut() runs in the host, so it works despite
          // the sandbox's clipboard restrictions.
          if (a.yank) {
            await editor.cut();
          } else {
            await editor.delete();
          }
        }
        this.lastCaret = a.start;
        break;
      }

      case 'insertText':
        await this.insertAt(a.at, a.text);
        this.lastCaret = a.at + a.text.length;
        break;

      case 'copyText': {
        // Yank without deleting. Preferred: a direct clipboard write from the
        // sandbox. Fallback: select the range, native-CUT it (host-side
        // clipboard, always works), and reinsert the same text — net no-op on
        // the document, exact text on the clipboard.
        const ok = await this.writeClipboard(a.text);
        if (!ok && a.start != null && a.end != null && a.end > a.start) {
          await editor.selectText({ start: a.start, end: a.end });
          await editor.cut();
          await editor.insertPlainText(a.text);
          if (this.model) this.model.caret = clamp(a.end, 0, this.model.text.length);
          this.lastCaret = a.end;
        }
        break;
      }

      case 'moveVertical':
        for (let i = 0; i < a.count; i++) {
          await editor.moveCaretVertical(a.dir);
        }
        break;

      case 'undo':
        await editor.undo();
        break;
      case 'redo':
        await editor.redo();
        break;

      case 'deleteRem': {
        const rems = await this.focusedPlusFollowing(a.count);
        if (rems.length === 0) break;
        this.lineRegister = [];
        for (const r of rems) {
          this.lineRegister.push(await this.captureSubtree(r));
        }
        await this.copyRegisterToClipboard();
        await this.removeRems(rems);
        this.lastCaret = 0;
        break;
      }

      case 'yankRem': {
        const rems = await this.focusedPlusFollowing(a.count);
        this.lineRegister = [];
        for (const r of rems) this.lineRegister.push(await this.captureSubtree(r));
        await this.copyRegisterToClipboard();
        break;
      }

      case 'pasteRem': {
        if (this.lineRegister.length === 0) break;
        // Anchor at the focused rem; after a cut (dd / V…d) focus is often
        // gone, so fall back to the remembered cut site — which is also the
        // vim-correct place to paste the cut lines back.
        let parent: { _id: string } | null = null;
        let at = 0;
        const focused = await focus.getFocusedRem();
        if (focused) {
          parent = (await focused.getParentRem()) ?? null;
          const pos = (await focused.positionAmongstSiblings()) ?? 0;
          at = a.where === 'below' ? pos + 1 : pos;
        } else if (this.lastCutSite) {
          parent = this.lastCutSite.parentId
            ? ((await rem.findOne(this.lastCutSite.parentId)) as unknown as { _id: string } | null)
            : null;
          at = this.lastCutSite.pos;
        } else {
          break;
        }
        let firstPastedId: string | null = null;
        for (let i = 0; i < a.count; i++) {
          for (const node of this.lineRegister) {
            const id = await this.pasteSubtree(node, parent, at);
            if (!id) break;
            if (!firstPastedId) firstPastedId = id;
            at++;
          }
        }
        // vim puts the cursor on the pasted line
        if (firstPastedId) await this.walkCaretTo(firstPastedId, 1);
        break;
      }

      case 'newBullet': {
        // Always a SIBLING (vim o/O), never a child — even when the current
        // bullet has an expanded subtree. The caret then walks visible rows
        // until it lands in the new bullet.
        const focused = await focus.getFocusedRem();
        if (!focused) break;
        const parent = await focused.getParentRem();
        const pos = (await focused.positionAmongstSiblings()) ?? 0;
        const created = await rem.createRem();
        if (!created) break;
        await created.setParent(parent ?? null, a.where === 'below' ? pos + 1 : pos);
        await this.walkCaretTo(created._id, a.where === 'below' ? 1 : -1);
        this.model = { remId: created._id, text: '', caret: 0 };
        this.lastCaret = 0;
        break;
      }

      case 'scroll':
        for (let i = 0; i < a.count; i++) {
          await editor.moveCaretVertical(a.dir);
        }
        this.invalidateModel();
        break;

      case 'runEx':
        await this.runEx(a.cmd);
        break;

      case 'focusPane': {
        const panes = await this.plugin.window.getOpenPaneIds();
        if (panes.length < 2) break;
        const cur = await this.plugin.window.getFocusedPaneId();
        const idx = Math.max(0, panes.indexOf(cur));
        const next = panes[(idx + a.dir + panes.length) % panes.length];
        await this.plugin.window.setFocusedPaneId(next);
        this.invalidateModel();
        break;
      }

      case 'indent': {
        const focused = await focus.getFocusedRem();
        if (!focused) break;
        const parent = await focused.getParentRem();
        if (!parent) break;
        const pos = await focused.positionAmongstSiblings();
        if (pos == null || pos === 0) break;
        const siblings = await parent.getChildrenRem();
        const prev = siblings[pos - 1];
        if (!prev) break;
        await focused.setParent(prev, (prev.children ?? []).length);
        break;
      }

      case 'outdent': {
        const focused = await focus.getFocusedRem();
        if (!focused) break;
        const parent = await focused.getParentRem();
        // Top-level bullet (parent is the page/document): vim `<` is a no-op.
        // Without this guard the bullet would be lifted OUT of the document.
        if (!parent || (await parent.isDocument())) break;
        const grand = await parent.getParentRem();
        if (!grand) break;
        const parentPos = (await parent.positionAmongstSiblings()) ?? 0;
        await focused.setParent(grand, parentPos + 1);
        break;
      }

      case 'vStart': {
        const focused = await focus.getFocusedRem();
        this.dbgV = `anch:${focused ? 'ok' : 'NULL'}`;
        if (!focused) break;
        this.vTrail = [focused._id];
        this.vSelIds = await this.expandWithDescendants([focused._id]);
        break;
      }

      case 'vExtend': {
        // Walk the REAL caret through visible rows (vim's V+j/k), recording
        // the trail. Crossing out of a sibling list into parents, uncles or
        // children works because moveCaretVertical moves by visual rows.
        if (!this.vTrail || this.vTrail.length === 0) break;
        for (let i = 0; i < Math.min(a.count, 300); i++) {
          const headBefore = this.vTrail[this.vTrail.length - 1];
          await editor.moveCaretVertical(a.dir);
          const f = await focus.getFocusedRem();
          if (!f || f._id === headBefore) break; // document boundary
          if (this.vTrail.length >= 2 && this.vTrail[this.vTrail.length - 2] === f._id) {
            this.vTrail.pop(); // stepping back over the trail shrinks it
          } else {
            this.vTrail.push(f._id);
          }
        }
        const units = await this.normalizedTrail();
        this.vSelIds = await this.expandWithDescendants(units);
        this.dbgV = `trail:${this.vTrail.length} units:${units.length} tint:${this.vSelIds.length}`;
        break;
      }

      case 'deleteRemSelection': {
        const rems = await this.vUnits();
        this.dbgV = `DEL n:${rems.length}`;
        if (rems.length === 0) break;
        this.lineRegister = [];
        for (const r of rems) this.lineRegister.push(await this.captureSubtree(r));
        await this.copyRegisterToClipboard();
        await this.removeRems(rems);
        this.clearVTrail();
        this.invalidateModel();
        break;
      }

      case 'yankRemSelection': {
        const rems = await this.vUnits();
        this.lineRegister = [];
        for (const r of rems) this.lineRegister.push(await this.captureSubtree(r));
        await this.copyRegisterToClipboard();
        this.clearVTrail();
        break;
      }

      case 'indentSelection':
      case 'outdentSelection': {
        const rems = await this.vUnits();
        if (rems.length === 0) break;
        // Re-parenting the focused Rem unmounts its editor and kills the
        // caret; park the caret on a stable neighbor first.
        await this.walkCaretOut(new Set(rems.map((r) => r._id)));
        if (a.t === 'indentSelection') {
          // each selection unit tucks under its previous sibling (vim >),
          // top-down so consecutive siblings stack in original order
          for (const r of rems) {
            const parent = await r.getParentRem();
            const pos = await r.positionAmongstSiblings();
            if (!parent || pos == null || pos === 0) continue;
            const siblings = await parent.getChildrenRem();
            const prev = siblings[pos - 1];
            if (!prev) continue;
            await r.setParent(prev, (prev.children ?? []).length);
          }
        } else {
          // each unit moves to just after its parent; bottom-up keeps the
          // relative order of units that shared a parent
          for (let i = rems.length - 1; i >= 0; i--) {
            const r = rems[i];
            const parent = await r.getParentRem();
            // Never outdent past the page: a top-level bullet stays put
            // (otherwise it would be ejected out of the document).
            if (!parent || (await parent.isDocument())) continue;
            const grand = await parent.getParentRem();
            if (!grand) continue;
            const parentPos = (await parent.positionAmongstSiblings()) ?? 0;
            await r.setParent(grand, parentPos + 1);
          }
        }
        this.clearVTrail();
        // vim leaves the cursor on the (first) operated line
        await this.walkCaretTo(rems[0]._id, -1);
        this.invalidateModel();
        break;
      }

      case 'clearRemSelection':
        // the "selection" is CSS-only; the caret stays where the head walked
        this.clearVTrail();
        break;

      case 'goDoc': {
        await this.recordJump(); // gg/G are jumps — Ctrl-O returns here
        const dir = a.where === 'start' ? -1 : 1;
        let prevId: string | undefined;
        for (let i = 0; i < 200; i++) {
          await editor.moveCaretVertical(dir as -1 | 1);
          const f = await focus.getFocusedRem();
          if (!f || f._id === prevId) break;
          prevId = f._id;
        }
        break;
      }

      case 'jump': {
        const cur = (await focus.getFocusedRem())?._id;
        if (a.dir === -1) {
          if (this.jumpPos === this.jumps.length) {
            // First hop back from the live position: stash it so Ctrl-I can
            // return, then step onto the previous entry.
            if (cur && this.jumps[this.jumps.length - 1] !== cur) {
              this.jumps.push(cur);
            }
            this.jumpPos = this.jumps.length - 1;
            if (this.jumpPos > 0 && this.jumps[this.jumpPos] === cur) this.jumpPos--;
          } else if (this.jumpPos > 0) {
            this.jumpPos--;
          } else {
            break;
          }
        } else {
          if (this.jumpPos >= this.jumps.length - 1) break;
          this.jumpPos++;
        }
        const targetId = this.jumps[this.jumpPos];
        if (targetId && targetId !== cur) await this.focusRemById(targetId);
        break;
      }

      case 'mode':
        if (a.mode === 'insert') {
          // Put the *real* caret where the model says before native typing
          // begins, then remember the line so we can recover the caret on exit.
          const m = this.model;
          if (m) await this.setCaretAbs(m.caret, m.text.length);
          this.insertEntryText = m?.text ?? snap.text;
        } else if (this.insertEntryText != null) {
          await this.reconcileAfterInsert();
        }
        await this.applyMode(a.mode);
        break;
    }
  }

  /**
   * Insert `text` at offset `at`: walk the real caret there with a relative
   * CHARACTER move from the model's pre-action position, then insert. Used by
   * `r`, backtick (case toggle), and character-register `p`.
   */
  private async insertAt(at: number, text: string) {
    const { editor } = this.plugin;
    const from = this.model?.caret ?? this.lastCaret;
    const len = this.model?.text.length ?? at;
    const to = clamp(at, 0, len);
    const delta = to - from;
    if (delta !== 0) {
      await editor.moveCaret(delta, MoveUnit.CHARACTER);
    }
    await editor.insertPlainText(text);
  }

  /**
   * Move the real caret to offset `at` via a relative CHARACTER delta from the
   * model's current position (the one caret primitive RemNote honors).
   */
  private async setCaretAbs(at: number, textLen: number) {
    const from = this.model?.caret ?? this.lastCaret;
    const to = clamp(at, 0, textLen);
    const delta = to - from;
    if (delta !== 0) {
      await this.plugin.editor.moveCaret(delta, MoveUnit.CHARACTER);
    }
  }

  /** Leaving insert mode: re-read the line, take the real caret if we can. */
  private async reconcileAfterInsert() {
    const pre = this.insertEntryText ?? '';
    this.insertEntryText = null;
    const rich = await this.plugin.editor.getFocusedEditorText();
    const fresh = rich ? (await this.plugin.richText.toString(rich)) ?? '' : '';
    const doc = hostDocument();
    const domCaret = doc ? readDomCaret(doc) : null;
    const caret = clamp(domCaret ?? diffCaret(pre, fresh, this.model?.caret ?? 0), 0, fresh.length);
    const remId = this.model?.remId;
    this.model = { remId, text: fresh, caret };
    this.lastCaret = caret;
  }

  // ------------------------------------------------- Ex commands

  /**
   * Execute an Ex command line (the text after `:`). RemNote autosaves, so the
   * write/quit family is mostly acknowledgement; `:e`/`:find` do a real search
   * and open the top hit; `:Ex` can't pop the native omnibar (no SDK hook) so
   * it points the user at Ctrl/Cmd-P.
   */
  private async runEx(cmd: string) {
    // Shift is invisible to the key capture, so ':Ex' arrives as ':ex' —
    // verbs are matched case-insensitively.
    const [verbRaw, ...restParts] = cmd.split(/\s+/);
    const verb = verbRaw.toLowerCase();
    const arg = restParts.join(' ').trim();
    const app = this.plugin.app;
    switch (verb) {
      case 'w':
      case 'write':
      case 'w!':
        await app.toast('Saved (RemNote autosaves)');
        return;
      case 'wq':
      case 'x':
      case 'x!':
      case 'wq!':
        await app.toast('Saved (RemNote autosaves)');
        return;
      case 'q':
      case 'q!':
      case 'quit':
        // Nothing destructive to do in an always-saved outliner; no-op.
        return;
      case 'e':
      case 'edit':
      case 'find':
      case 'f':
        if (!arg) {
          await app.toast('Usage: :e <rem name>');
          return;
        }
        await this.recordJump(); // :e is a jump — Ctrl-O comes back
        await this.openByName(arg);
        return;
      case 'ex':
      case 'explore':
        await app.toast('Open the Rem explorer with Ctrl/Cmd-P');
        return;
      // --- bulk commands: act on the visual-line selection when one is
      // active (command mode entered with ; or / from visual mode), else on
      // the focused bullet.
      case 'todo':
        await this.applyToTargets('→ todo', (r) => r.setIsTodo(true));
        return;
      case 'done':
        await this.applyToTargets('→ done', async (r) => {
          await r.setIsTodo(true);
          await r.setTodoStatus('Finished');
        });
        return;
      case 'untodo':
      case 'notodo':
        await this.applyToTargets('todo removed', (r) => r.setIsTodo(false));
        return;
      case 'help':
      case 'h':
        await this.openHelp();
        return;
      default:
        await app.toast(`Not an editor command: ${cmd} — try :help`);
    }
  }

  /** The rems a bulk Ex command acts on: selection units, else the focused rem. */
  private async exTargets() {
    const units = await this.vUnits();
    if (units.length > 0) return units;
    const f = await this.plugin.focus.getFocusedRem();
    return f ? [f] : [];
  }

  private async applyToTargets(
    label: string,
    fn: (r: { setIsTodo: (b: boolean) => Promise<void>; setTodoStatus: (s: 'Finished' | 'Unfinished') => Promise<void> }) => Promise<void>
  ) {
    const targets = await this.exTargets();
    if (targets.length === 0) {
      await this.plugin.app.toast('No bullet selected');
      return;
    }
    for (const r of targets) {
      await fn(r as unknown as Parameters<typeof fn>[0]);
    }
    await this.plugin.app.toast(`${targets.length} bullet${targets.length > 1 ? 's' : ''} ${label}`);
  }

  /** Floating widget id of the open :help window, if any. */
  private helpWidgetId: string | null = null;

  /** Open (or re-open) the :help cheat-sheet window. */
  async openHelp() {
    await this.closeHelp();
    this.helpWidgetId = await this.plugin.window.openFloatingWidget(
      'vim_help',
      { top: 55, left: 80 },
      undefined,
      true // close when clicking outside
    );
  }

  private async closeHelp() {
    if (this.helpWidgetId) {
      await this.plugin.window.closeFloatingWidget(this.helpWidgetId).catch(() => {});
      this.helpWidgetId = null;
    }
  }

  /** `:e <name>` — search for a Rem by name and open the best match. */
  private async openByName(name: string) {
    try {
      const results = await this.plugin.search.search([name]);
      const top = results?.[0];
      if (top) {
        await this.plugin.window.openRem(top);
      } else {
        await this.plugin.app.toast(`No Rem matching "${name}"`);
      }
    } catch (e) {
      await this.plugin.app.toast(`Search failed: ${String(e)}`);
    }
  }

  // ------------------------------------------------- structural helpers

  /** Flatten register nodes to tab-indented plain text (for the clipboard). */
  private registerToText(nodes: RegisterNode[], depth = 0): string {
    let out = '';
    for (const n of nodes) {
      const line = (n.text ?? [])
        .map((x) => (typeof x === 'string' ? x : ((x as { text?: string }).text ?? '')))
        .join('');
      out += '\t'.repeat(depth) + line + '\n';
      out += this.registerToText(n.children, depth + 1);
    }
    return out;
  }

  /**
   * Write `text` to the SYSTEM clipboard from the sandboxed widget iframe.
   * Tries the async clipboard API first, then the legacy execCommand path.
   * Returns false when both are blocked (unfocused sandbox documents may
   * reject clipboard writes) so callers can try a native-editor fallback.
   */
  private async writeClipboard(text: string): Promise<boolean> {
    if (!text) return true;
    try {
      await navigator.clipboard.writeText(text);
      this.dbgClip = 'clip:api';
      return true;
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      this.dbgClip = ok ? 'clip:exec' : 'clip:FAIL';
      return ok;
    } catch {
      this.dbgClip = 'clip:FAIL';
      return false;
    }
  }

  /** Best-effort copy of the line register (vim yanks are OS yanks). */
  private async copyRegisterToClipboard() {
    const text = this.registerToText(this.lineRegister).replace(/\n$/, '');
    if (!text) return;
    await this.writeClipboard(text);
  }

  // ------------------------------------------------- jumplist

  /** Record the current position before a jump command leaves it (vim m'). */
  private async recordJump() {
    const f = await this.plugin.focus.getFocusedRem();
    if (!f) return;
    // A new jump truncates the forward part of the list, like vim.
    this.jumps = this.jumps.slice(0, this.jumpPos);
    if (this.jumps[this.jumps.length - 1] !== f._id) this.jumps.push(f._id);
    this.jumpPos = this.jumps.length;
  }

  /**
   * Put the caret into `id`: walk visible rows if it is on screen in the
   * current document (keeps the caret alive), otherwise open the rem — the
   * cross-document case, where a click is needed afterwards anyway.
   */
  private async focusRemById(id: string) {
    if (await this.walkCaretTo(id, -1)) return;
    const r = await this.plugin.rem.findOne(id);
    if (r) await this.plugin.window.openRem(r);
  }

  /** Serialize a Rem including its whole subtree into a register node. */
  private async captureSubtree(r: {
    text?: unknown;
    getChildrenRem: () => Promise<unknown[]>;
  }, depth = 0): Promise<RegisterNode> {
    const node: RegisterNode = { text: (r.text as RichTextInterface) ?? [], children: [] };
    if (depth < 20) {
      const kids = (await r.getChildrenRem()) as {
        text?: unknown;
        getChildrenRem: () => Promise<unknown[]>;
      }[];
      for (const k of kids) {
        node.children.push(await this.captureSubtree(k, depth + 1));
      }
    }
    return node;
  }

  /** Create Rems from a register node under `parent` at position `at`. */
  private async pasteSubtree(node: RegisterNode, parent: unknown, at: number): Promise<string | null> {
    const created = await this.plugin.rem.createRem();
    if (!created) return null;
    await created.setText(node.text);
    await created.setParent((parent as never) ?? null, at);
    let childAt = 0;
    for (const child of node.children) {
      await this.pasteSubtree(child, created, childAt++);
    }
    return created._id;
  }

  /** True if `remId` is one of `ids` or lies inside one of their subtrees. */
  private async inRemovedSubtree(remId: string, ids: Set<string>): Promise<boolean> {
    let cur = await this.plugin.rem.findOne(remId);
    for (let hop = 0; cur && hop < 15; hop++) {
      if (ids.has(cur._id)) return true;
      const parent = (cur as unknown as { parent?: string }).parent;
      if (!parent) return false;
      cur = await this.plugin.rem.findOne(parent);
    }
    return false;
  }

  /**
   * Walk the LIVE text caret out of the doomed subtree(s) BEFORE deleting.
   * moveCaretVertical only works while a text editor is focused — once the
   * focused rem is removed the caret is unrecoverable programmatically — so
   * escape first, delete second.
   */
  private async walkCaretOut(removedIds: Set<string>): Promise<boolean> {
    const { editor, focus } = this.plugin;
    for (const dir of [1, -1] as const) {
      let prevId: string | null = null;
      for (let i = 0; i < 30; i++) {
        await editor.moveCaretVertical(dir);
        const f = await focus.getFocusedRem();
        if (!f) break;
        if (!(await this.inRemovedSubtree(f._id, removedIds))) return true;
        if (f._id === prevId) break; // hit the document boundary
        prevId = f._id;
      }
    }
    return false;
  }

  /**
   * Remove Rems (a dd or visual-line cut): remember the cut site for
   * paste-after-cut, walk the caret to safety, then delete. The caret ends on
   * the neighboring survivor, so `p`, motions and indent keep working without
   * a mouse click.
   *
   * If there is NO survivor to walk to (deleting the only bullet(s) of the
   * document), vim semantics apply: keep one line, emptied. We clear the
   * focused Rem's text instead of removing it, so the caret stays alive.
   */
  private async removeRems(rems: { _id: string; getParentRem: () => Promise<unknown>; positionAmongstSiblings: () => Promise<number | undefined>; remove: () => Promise<void>; setText?: (t: RichTextInterface) => Promise<void> }[]) {
    const first = rems[0];
    const parent = (await first.getParentRem()) as { _id: string } | undefined;
    const pos = (await first.positionAmongstSiblings()) ?? 0;
    this.lastCutSite = { parentId: parent?._id ?? null, pos };
    const removedIds = new Set(rems.map((r) => r._id));
    const escaped = await this.walkCaretOut(removedIds);
    let keepId: string | null = null;
    if (!escaped) {
      // nowhere to go — keep the rem the caret is in (or the first one),
      // clear it, and delete the rest
      const f = await this.plugin.focus.getFocusedRem();
      keepId = f && removedIds.has(f._id) ? f._id : rems[0]._id;
    }
    for (const r of rems) {
      if (r._id === keepId && r.setText) {
        await r.setText([]);
      } else {
        await r.remove();
      }
    }
    this.invalidateModel();
    this.lastCaret = 0;
  }

  /**
   * Expand selection-unit ids with all their descendants. RemNote's DOM does
   * NOT nest child rows inside the parent's [data-rem-id] container, so the
   * CSS tint must name every row explicitly for subtrees to look selected.
   */
  private async expandWithDescendants(ids: string[]): Promise<string[]> {
    const out: string[] = [];
    const walk = async (id: string, depth: number) => {
      if (out.length > 400 || depth > 20 || out.includes(id)) return;
      out.push(id);
      const r = await this.plugin.rem.findOne(id);
      for (const kid of (r?.children ?? []) as string[]) {
        await walk(kid, depth + 1);
      }
    };
    for (const id of ids) await walk(id, 0);
    return out;
  }

  /**
   * Walk the live caret through visible rows until it lands in `targetId`
   * (tries `firstDir` first, then the other way). Used to put the cursor on
   * a bullet we just created/moved — selectRem would kill the caret instead.
   */
  private async walkCaretTo(targetId: string, firstDir: -1 | 1 = 1) {
    const { editor, focus } = this.plugin;
    if ((await focus.getFocusedRem())?._id === targetId) return true;
    for (const dir of [firstDir, -firstDir] as const) {
      let prevId: string | null = null;
      for (let i = 0; i < 60; i++) {
        await editor.moveCaretVertical(dir as -1 | 1);
        const f = await focus.getFocusedRem();
        if (!f) break;
        if (f._id === targetId) return true;
        if (f._id === prevId) break; // boundary
        prevId = f._id;
      }
    }
    return false;
  }

  /** Clear the visual-line trail and its CSS highlight. */
  private clearVTrail() {
    this.vTrail = null;
    this.vSelIds = [];
  }

  /** Is `remId` a strict descendant of `ancestorId`? */
  private async isDescendantOf(remId: string, ancestorId: string): Promise<boolean> {
    let cur = await this.plugin.rem.findOne(remId);
    for (let hop = 0; cur && hop < 20; hop++) {
      const parent = (cur as unknown as { parent?: string }).parent;
      if (!parent) return false;
      if (parent === ancestorId) return true;
      cur = await this.plugin.rem.findOne(parent);
    }
    return false;
  }

  /**
   * The selection trail reduced to its top-level units, in visual order:
   * ids covered by another trail id's subtree are dropped (walking down
   * through a parent's children keeps just the parent).
   */
  private async normalizedTrail(): Promise<string[]> {
    const trail = this.vTrail ?? [];
    const out: string[] = [];
    for (const id of trail) {
      let covered = false;
      for (const other of trail) {
        if (other !== id && (await this.isDescendantOf(id, other))) {
          covered = true;
          break;
        }
      }
      if (!covered && !out.includes(id)) out.push(id);
    }
    return out;
  }

  /** Resolve the normalized trail to RemObjects (visual order). */
  private async vUnits() {
    const ids = await this.normalizedTrail();
    const rems = [];
    for (const id of ids) {
      const r = await this.plugin.rem.findOne(id);
      if (r) rems.push(r);
    }
    return rems;
  }

  /** The focused Rem plus up to count-1 following siblings. */
  private async focusedPlusFollowing(count: number) {
    const focused = await this.plugin.focus.getFocusedRem();
    if (!focused) return [];
    if (count <= 1) return [focused];
    const parent = await focused.getParentRem();
    if (!parent) return [focused];
    const siblings = await parent.getChildrenRem();
    const idx = siblings.findIndex((s) => s._id === focused._id);
    if (idx < 0) return [focused];
    return siblings.slice(idx, idx + count);
  }

  // ------------------------------------------------------------ mode UI

  private async applyMode(mode: Mode) {
    const wanted = new Set(bindingsForMode(mode).map((b) => b.spec));
    const toSteal = [...wanted].filter((s) => !this.stolenSpecs.has(s));
    const toRelease = [...this.stolenSpecs].filter((s) => !wanted.has(s));
    if (toSteal.length) await this.plugin.app.stealKeys(toSteal);
    if (toRelease.length) await this.plugin.app.releaseKeys(toRelease);
    this.stolenSpecs = wanted;
    await this.render();
  }

  /** One CSS block (single id) draws the mode label, debug readout, and the
   * visual-line selection highlight (RemNote's own rem-selection rendering is
   * not guaranteed, so we tint the selected bullets ourselves). */
  private async render() {
    const mode = this.state.mode;
    const color = MODE_COLORS[mode];
    // In command mode show the `:` line being typed; otherwise the mode name.
    const label =
      mode === 'command'
        ? `:${this.state.commandLine.replace(/["\\]/g, '')}`
        : `-- ${MODE_LABELS[mode]} --`;
    // The visual-line tint survives into command mode so the user can see
    // what :todo/:done will act on while typing the command.
    const selCss =
      (mode === 'visual-line' || mode === 'command') && this.vSelIds.length
        ? this.vSelIds
            .map(
              (id) =>
                `[data-rem-id="${id}"] { background: rgba(217,119,6,0.16); border-radius: 4px; }`
            )
            .join('\n')
        : '';
    // Cursorline: outside insert mode the focused row gets a faint tint and a
    // colored bar at its left edge, so the (thin) caret is findable at a
    // glance — vim's 'cursorline' for an outliner.
    const cursorLineCss =
      mode === 'normal' || mode === 'visual' || mode === 'command'
        ? `
      [data-rem-id]:focus-within {
        background: rgba(124,58,237,0.07); border-radius: 4px;
        box-shadow: inset 3px 0 0 0 ${color};
      }`
        : '';
    await this.plugin.app.registerCSS(
      'vim-mode',
      `
      body::after {
        content: "${label}";
        position: fixed; right: 14px; bottom: 12px; z-index: 99999;
        padding: 2px 10px; border-radius: 6px;
        font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.08em; background: ${color}; color: #fff;
        pointer-events: none; opacity: 0.9;
      }
      body::before {
        content: "vim ${mode} rx=${this.dbgCount} done=${this.dbgDone} k=${this.dbgLast} ${this.dbgV} ${this.dbgClip}";
        position: fixed; left: 8px; bottom: 8px; z-index: 99999; max-width: 90vw;
        font: 10px ui-monospace, monospace; color: #aaa; white-space: nowrap; overflow: hidden;
        background: rgba(0,0,0,0.6); padding: 1px 6px; border-radius: 4px;
        pointer-events: none;
      }
      ${mode !== 'insert' ? `[contenteditable="true"] { caret-color: ${color}; }` : ''}
      ${cursorLineCss}
      ${selCss}
      `
    );
  }
}
