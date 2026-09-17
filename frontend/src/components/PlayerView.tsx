import { useLanguage } from "../LanguageProvider";
import { BookOpenText, ShieldCheck, Skull, UserRound } from "lucide-react";
import { allRoles } from "../game";
import { phaseLabel } from "../timeline";
import type { PlayerView as PlayerViewData, Script } from "../types";
import { playerLabel } from "../voting";
import { PublicBallot } from "./PublicBallot";

interface PlayerViewProps {
  view: PlayerViewData;
  script: Script;
}

/** This component accepts only the backend projection, never a storyteller snapshot. */
export function PlayerView({ view, script }: PlayerViewProps) {
  const { t, localize, language, locale } = useLanguage();
  const role = allRoles(script).find((item) => item.id === view.you.shown_role_id);
  const viewer = view.seats.find((seat) => seat.id === view.you.seat_id);
  const alignment = { good: t("善良"), evil: t("邪恶"), unknown: t("未告知 / 未记录") };
  return (
    <main className="player-view panel-shell">
      <header className="player-view-heading">
        <div>
          <span className="eyebrow">{t("玩家视角")}</span>
          <h1>{viewer?.position} {t("号 ·")} {viewer?.player_name}</h1>
          <p>{localize(script.name)} · {phaseLabel(view, language)}</p>
        </div>
        <ShieldCheck size={24} />
      </header>
      <div className="player-knowledge-grid">
        <section className="player-information">
          <h2>{t("你的身份信息")}</h2>
          <p>{t("展示角色：")}<strong>{role ? localize(role.name) : t("未告知 / 未记录")}</strong></p>
          <p>{t("告知阵营：")}{alignment[view.you.shown_alignment]}</p>
          {role && (
            <article className={`ability-card ${role.team}`}>
              <div><BookOpenText size={14} /><strong>{localize(role.name)}</strong></div>
              <p>{localize(role.ability)}</p>
            </article>
          )}
        </section>
        <section className="player-information">
          <h2>{t("你收到的私人信息")}</h2>
          <p className="recorded-information">{view.you.private_information || t("尚未记录")}</p>
        </section>
      </div>
      <section className="player-information">
        <h2>{t("公开信息")}</h2>
        <p className="recorded-information">{view.public_information || t("尚未记录")}</p>
      </section>
      <section className="public-players">
        <h2>{t("玩家与公开声明")}</h2>
        <p className="field-hint">{t("公开声明是玩家的说法，可能包含伪装或错误信息。")}</p>
        <div className="public-seat-grid">
          {view.seats.map((seat) => (
            <article key={seat.id} className={`public-seat ${seat.id === view.you.seat_id ? "is-you" : ""}`}>
              <header>
                <b>{seat.position} {t("号 ·")} {seat.player_name}{seat.id === view.you.seat_id ? t("（你）") : ""}</b>
                <span>{seat.alive ? <UserRound size={13} /> : <Skull size={13} />}{seat.alive ? t("存活") : t("死亡")}</span>
              </header>
              <p className="recorded-information">{seat.public_claim || t("尚未公开声明")}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="player-information">
        <h2>{t("公开提名与投票")}</h2>
        <p className="field-hint">{t("所有玩家都能查看；未记录、未举手和取消的投票分别保留。")}</p>
        {!view.nominations.length && <p>{t("截至当前时刻，尚未记录提名。")}</p>}
        {view.nominations.map((nomination) => <PublicBallot key={nomination.id} nomination={nomination} />)}
      </section>
      <section className="player-information personal-history">
        <h2>{t("你的个人历史")} <span>{view.history.length === 1 ? t("1 条记录") : t("{0} 条记录", [view.history.length])}</span></h2>
        <p className="field-hint">{t("公开事件及明确提供给你的信息，按记录顺序排列。下方内容会自动进入玩家代理输入；回放只包含当前时刻之前的记录。")}</p>
        {!view.history.length && <p>{t("尚无可见历史。起点之前的过程不会补猜，当前已知信息见上方。")}</p>}
        <ol>
          {view.history.map((entry) => <li key={entry.id}>
            <header>
              <b>{phaseLabel(entry, language)}</b>
              <span>{entry.visibility === "public" ? t("公开") : t("对你可见")}</span>
              <time dateTime={entry.recorded_at}>{new Date(entry.recorded_at).toLocaleString(locale)}</time>
            </header>
            <p className="recorded-information">{entry.kind === "nomination" ? t(entry.text) : entry.text}</p>
            {(entry.actor || entry.targets.length > 0) && <p className="field-hint">
              {entry.actor ? playerLabel(entry.actor, language) : t("说书人")}
              {entry.targets.length > 0 && ` → ${entry.targets.map((target) => playerLabel(target, language)).join(language === "en" ? ", " : "、")}`}
            </p>}
            {entry.nomination && <PublicBallot nomination={entry.nomination} />}
            <small className="history-event-id">{t("事件 ID：")}{entry.event_id}</small>
          </li>)}
        </ol>
      </section>
    </main>
  );
}
