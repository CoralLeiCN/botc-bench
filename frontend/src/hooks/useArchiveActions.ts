import { api } from "../api";
import { useLanguage } from "../LanguageProvider";
import { createDraft } from "../game";
import { readError } from "../errors";
import { uiMessage, type UiMessage } from "../language";
import type { GameRecord, RecordState, Script } from "../types";
import type { GameDocument } from "./useGameDocument";
import type { GamePersistence } from "./useGamePersistence";

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url; anchor.download = filename;
  window.document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useArchiveActions(document: GameDocument, persistence: GamePersistence, script: Script | null, notify: (notice: UiMessage | null) => void) {
  const { t, language } = useLanguage();
  const saveSource = async (): Promise<GameRecord | RecordState | null> => {
    const current = document.capture();
    return current.dirty || !current.record ? persistence.saveGame() : current.record;
  };
  const perform = (action: () => Promise<void>, failure: string): Promise<void> => persistence.runArchive(async () => {
    try { await action(); }
    catch (error) { notify(uiMessage(failure, [readError(error)])); }
  });
  const newGame = (): void => {
    if (!script || persistence.isBusy()) return;
    if (document.dirty && !window.confirm(t("当前局面还有未保存修改。仍要新建吗？"))) return;
    document.start(createDraft(script, document.game?.player_count ?? 7, language));
    persistence.resetFailure(); notify(null);
  };
  const branch = (): Promise<void> => perform(async () => {
    const current = document.capture();
    if (current.replayIndex === null) return;
    const event = current.timeline[current.replayIndex];
    const source = await saveSource();
    if (!source || !event) return;
    persistence.adopt(await api.branchGame(source.id, event.id, source.version));
    notify(uiMessage("已创建并保存分支，可以从这个时刻继续编辑"));
    await persistence.refreshGames();
  }, "创建分支失败：{0}");
  const duplicate = (): Promise<void> => perform(async () => {
    if (!document.capture().record) return;
    const source = await saveSource();
    if (!source) return;
    persistence.adopt(await api.duplicateGame(source.id, source.version));
    notify(uiMessage("已创建独立副本，原局面与分析仍保留"));
    await persistence.refreshGames();
  }, "复制失败：{0}");
  const exportGame = (): Promise<void> => perform(async () => {
    const source = await saveSource();
    if (!source) return;
    const archive = await api.exportGame(source.id);
    downloadJson(archive, `${archive.game.draft.name.replace(/[\\/:*?"<>|]/g, "_") || "game"}.json`);
    notify(uiMessage("已导出完整存档：当前局面、时间线和已保存分析"));
  }, "导出失败：{0}");
  const importGame = (file: File): Promise<void> => perform(async () => {
    if (document.dirty && !window.confirm(t("当前局面还有未保存修改。仍要导入并载入新存档吗？"))) return;
    if (file.size > 50 * 1024 * 1024) throw new Error(t("文件超过 50 MB，请使用较小的单局备份"));
    const imported = await api.importGame(JSON.parse(await file.text()));
    persistence.adopt(imported);
    notify(uiMessage("已导入「{0}」为独立存档", [imported.draft.name]));
    await persistence.refreshGames();
  }, "导入失败：{0}");
  return { newGame, branch, duplicate, exportGame, importGame };
}
