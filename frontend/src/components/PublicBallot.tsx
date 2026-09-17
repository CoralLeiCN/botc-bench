import type { Nomination } from "../types";
import { playerLabel, voteTotal } from "../voting";
import { useLanguage } from "../LanguageProvider";

/** Public voting data only; no storyteller state or role-based explanations. */
export function PublicBallot({ nomination }: { nomination: Nomination }) {
  const { t, language } = useLanguage();
  const status = { open: "进行中", closed: "已完成", cancelled: "已取消" };
  return <details className="public-ballot">
    <summary>
      {t("第 {0} 天", [nomination.day_number])} · {playerLabel(nomination.nominator, language)} → {playerLabel(nomination.nominee, language)}
      <span>{t(status[nomination.status])} · {t("{0} 票", [voteTotal(nomination)])}</span>
    </summary>
    <p>{t("记录门槛：{0} 票", [Math.ceil(nomination.alive_count / 2)])}
      {nomination.status !== "closed" && ` · ${t("尚无正式计票结果")}`}</p>
    <ul className="public-votes">
      {nomination.votes.map((vote) => <li key={vote.player.id}>
        <span>{playerLabel(vote.player, language)}</span>
        <b>{vote.choice === "pending" ? t("未记录") : vote.choice === "no" ? t("未举手") : t("举手 · {0} 票", [vote.weight])}</b>
        {vote.dead_vote && <small>{t("亡者票")} · {nomination.status === "closed" ? t("已使用") : t("未消耗")}</small>}
      </li>)}
    </ul>
  </details>;
}
