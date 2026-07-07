import { declareIndexPlugin, ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import { VimAdapter } from '../adapter/adapter';

let adapter: VimAdapter | undefined;

async function onActivate(plugin: ReactRNPlugin) {
  await plugin.settings.registerBooleanSetting({
    id: 'start-in-normal',
    title: 'Start in normal mode',
    defaultValue: true,
  });

  // the :help window (fixed height — 'auto' collapses floating widgets to 0)
  await plugin.app.registerWidget('vim_help', WidgetLocation.FloatingWidget, {
    dimensions: { width: 690, height: 620 },
  });

  adapter = new VimAdapter(plugin);

  await plugin.app.registerCommand({
    id: 'vim-toggle',
    name: 'Vim: Toggle vim mode',
    action: async () => {
      await adapter?.toggle();
    },
  });

  await plugin.app.registerCommand({
    id: 'vim-help',
    name: 'Vim: Help / cheat sheet',
    action: async () => {
      await adapter?.openHelp();
    },
  });

  const startNormal = await plugin.settings.getSetting<boolean>('start-in-normal');
  await adapter.start(startNormal ? 'normal' : 'insert');
  console.debug('[vim] plugin activated, mode:', adapter.mode);

  // e2e hook: lets the Playwright driver reach the plugin API inside
  // this widget iframe to create test rems and assert editor state.
  (window as unknown as Record<string, unknown>).__vim = { plugin, adapter };
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
