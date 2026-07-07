import { renderWidget, usePlugin, WidgetLocation } from '@remnote/plugin-sdk';

/**
 * The `:help` window — a vim cheat sheet written for people who have never
 * used vim, plus the RemNote-specific key differences (shift-blind capture).
 * Opened as a floating widget by `:help` / `;help`; closes on ✕, click
 * outside, or Escape (the adapter closes it when Escape is pressed).
 */

function Key({ k }: { k: string }) {
  return <kbd>{k}</kbd>;
}

function Row({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <tr>
      <td className="keys">
        {keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="then"> then </span>}
            <Key k={k} />
          </span>
        ))}
      </td>
      <td>{desc}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      <table>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function VimHelp() {
  const plugin = usePlugin();

  const close = async () => {
    const ctx = await plugin.widget.getWidgetContext<WidgetLocation.FloatingWidget>();
    if (ctx?.floatingWidgetId) {
      await plugin.window.closeFloatingWidget(ctx.floatingWidgetId);
    }
  };

  return (
    <div className="vim-help">
      <style>{`
        .vim-help {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: var(--rn-clr-background-primary, #fff);
          color: var(--rn-clr-content-primary, #1a1a2e);
          border: 1px solid var(--rn-clr-border-primary, #d9d9e3);
          border-radius: 10px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.25);
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow-y: auto;
          padding: 18px 22px 22px;
          font-size: 13px;
          line-height: 1.45;
        }
        .vim-help header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 6px;
        }
        .vim-help h2 { margin: 0; font-size: 17px; }
        .vim-help .closeBtn {
          border: none; background: transparent; cursor: pointer;
          font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px;
          color: var(--rn-clr-content-secondary, #666);
        }
        .vim-help .closeBtn:hover { background: var(--rn-clr-background-secondary, #eee); }
        .vim-help .intro {
          background: var(--rn-clr-background-secondary, #f4f4f8);
          border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;
          color: var(--rn-clr-content-secondary, #444);
        }
        .vim-help .modes { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 2px; }
        .vim-help .modeChip {
          font: 600 10.5px ui-monospace, monospace; letter-spacing: .06em;
          color: #fff; border-radius: 5px; padding: 2px 8px;
        }
        .vim-help .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; }
        .vim-help .section { margin-bottom: 12px; break-inside: avoid; }
        .vim-help h3 {
          font-size: 12px; text-transform: uppercase; letter-spacing: .07em;
          color: var(--rn-clr-content-secondary, #777); margin: 0 0 4px;
          border-bottom: 1px solid var(--rn-clr-border-primary, #e5e5ee);
          padding-bottom: 3px;
        }
        .vim-help table { width: 100%; border-collapse: collapse; }
        .vim-help td { padding: 2.5px 0; vertical-align: top; }
        .vim-help td.keys { white-space: nowrap; padding-right: 12px; width: 1%; }
        .vim-help .then { color: var(--rn-clr-content-tertiary, #999); font-size: 11px; }
        .vim-help kbd {
          font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
          background: var(--rn-clr-background-secondary, #f0f0f5);
          border: 1px solid var(--rn-clr-border-primary, #d5d5e0);
          border-bottom-width: 2px;
          border-radius: 4px; padding: 1px 5px;
        }
        .vim-help .note {
          background: rgba(217,119,6,0.10);
          border: 1px solid rgba(217,119,6,0.35);
          border-radius: 8px; padding: 10px 12px; margin-top: 4px;
        }
        .vim-help .note b { color: #b45309; }
      `}</style>

      <header>
        <h2>Vim Mode — Help</h2>
        <button className="closeBtn" onClick={close} title="Close (Esc)">
          ✕
        </button>
      </header>

      <div className="intro">
        Vim has <b>modes</b>: in <b>NORMAL</b> mode keys are commands, in{' '}
        <b>INSERT</b> mode you type text as usual. Press <Key k="i" /> to start
        typing, press <Key k="Esc" /> to go back to commands. The badge in the
        bottom-right corner always shows the current mode:
        <div className="modes">
          <span className="modeChip" style={{ background: '#7c3aed' }}>NORMAL</span>
          <span className="modeChip" style={{ background: '#059669' }}>INSERT</span>
          <span className="modeChip" style={{ background: '#d97706' }}>VISUAL</span>
          <span className="modeChip" style={{ background: '#d97706' }}>V-LINE</span>
          <span className="modeChip" style={{ background: '#0ea5e9' }}>COMMAND</span>
        </div>
      </div>

      <div className="cols">
        <div>
          <Section title="Start / stop typing">
            <Row keys={['i']} desc="insert text at the cursor" />
            <Row keys={['a']} desc="insert after the cursor" />
            <Row keys={['o']} desc="new bullet below (start typing)" />
            <Row keys={['g', 'o']} desc="new bullet above" />
            <Row keys={['Esc']} desc="back to NORMAL (commands)" />
          </Section>

          <Section title="Move around">
            <Row keys={['h']} desc="left" />
            <Row keys={['l']} desc="right" />
            <Row keys={['j']} desc="bullet down" />
            <Row keys={['k']} desc="bullet up" />
            <Row keys={['w']} desc="next word" />
            <Row keys={['b']} desc="previous word" />
            <Row keys={['e']} desc="end of word" />
            <Row keys={['0']} desc="start of line" />
            <Row keys={['g', 'l']} desc="end of line  (vim: $)" />
            <Row keys={['g', 'h']} desc="first character  (vim: ^)" />
            <Row keys={['g', 'g']} desc="top of document" />
            <Row keys={['g', 'e']} desc="bottom of document  (vim: G)" />
            <Row keys={['f', '·']} desc="jump onto next ‘·’ in the line" />
            <Row keys={[',']} desc="repeat the last f jump (backwards)" />
          </Section>

          <Section title="Scroll & jumps">
            <Row keys={['Ctrl-d']} desc="half page down" />
            <Row keys={['Ctrl-u']} desc="half page up" />
            <Row keys={['Ctrl-o']} desc="back to before the last gg/ge/:e jump" />
            <Row keys={['Ctrl-i']} desc="forward again" />
            <Row keys={['Ctrl-w', 'h/l']} desc="focus previous / next pane" />
          </Section>
        </div>

        <div>
          <Section title="Edit">
            <Row keys={['x']} desc="delete character" />
            <Row keys={['d', 'w']} desc="delete to next word" />
            <Row keys={['d', 'i', 'w']} desc="delete the word you're in" />
            <Row keys={['c', 'w']} desc="change word (delete + type)" />
            <Row keys={['r', '·']} desc="replace character with ‘·’" />
            <Row keys={['`']} desc="toggle UPPER/lower case  (vim: ~)" />
            <Row keys={['d', 'd']} desc="cut whole bullet (with children)" />
            <Row keys={['y', 'y']} desc="copy whole bullet" />
            <Row keys={['p']} desc="paste bullet(s) below" />
            <Row keys={['u']} desc="undo" />
            <Row keys={['Ctrl-r']} desc="redo" />
          </Section>

          <Section title="Select (visual)">
            <Row keys={['v']} desc="select text in the bullet (h/l/w/b/e grow it)" />
            <Row keys={['v', 'v']} desc="select whole bullets  (vim: V)" />
            <Row keys={['v', 'j/k']} desc="j/k also switch to whole bullets" />
            <Row keys={['v', 'g', 'g']} desc="select up to the top of the doc" />
            <Row keys={['v', 'g', 'e']} desc="select down to the bottom" />
            <Row keys={['d']} desc="cut the selection" />
            <Row keys={['y']} desc="copy it (also to the clipboard)" />
            <Row keys={['p']} desc="paste" />
            <Row keys={['.']} desc="indent selected bullets  (vim: >)" />
            <Row keys={[',']} desc="outdent them  (vim: <)" />
            <Row keys={[';']} desc="run a command on the selection ↓" />
            <Row keys={['Esc']} desc="cancel selection" />
          </Section>

          <Section title="Command line">
            <Row keys={[';']} desc="open the : command line (also /)" />
            <Row keys={[':todo']} desc="make selected bullet(s) todos" />
            <Row keys={[':done']} desc="check them off" />
            <Row keys={[':untodo']} desc="remove the todo checkbox" />
            <Row keys={[':help']} desc="this window" />
            <Row keys={[':e name']} desc="search + open a page" />
            <Row keys={[':w', ':q']} desc="save / quit (RemNote autosaves)" />
          </Section>
        </div>
      </div>

      <div className="note">
        <b>RemNote differences:</b> RemNote cannot see the Shift key, so
        CAPITAL commands act like their lowercase letter (<Key k="V" /> ={' '}
        <Key k="v" />, <Key k="$" /> arrives as <Key k="4" />). Use the{' '}
        <Key k="g" />
        -shortcuts where vim uses capitals or symbols: <Key k="g" />
        <Key k="l" /> = <Key k="$" /> (and <Key k="d" />
        <Key k="g" />
        <Key k="l" /> = <Key k="d" />
        <Key k="$" />, delete to end of line). Deletes and yanks also land on
        the system clipboard. After clicking with the mouse inside a line,
        press <Key k="0" /> or <Key k="g" />
        <Key k="l" /> once to re-anchor the cursor.
      </div>
    </div>
  );
}

renderWidget(VimHelp);
