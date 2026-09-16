import { useLanguage } from "../LanguageProvider";
import { BookOpenText, ShieldCheck, Skull, UserRound } from "lucide-react";
import { allRoles } from "../game";
import { phaseLabel } from "../timeline";
import type { PlayerView as PlayerViewData, Script } from "../types";

interface PlayerViewProps {
  view: PlayerViewData;
  script: Script;
}

/** This component accepts only the backend projection, never a storyteller snapshot. */
export function PlayerView({ view, script }: PlayerViewProps) {
  const { t, localize, language } = useLanguage();
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
    </main>
  );
}
