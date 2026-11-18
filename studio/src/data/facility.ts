// 施設の基本情報。検索せずに即答するための唯一の正解データ（D-018）。
// ここに無いことはモデルに推測させない（営業時間の嘘は展示で致命的）。
// 展示前に null を実際の値で埋める。1行足すだけで反映される。

export interface FacilityInfo {
  name: string;
  kind: string;
  place: string | null;
  hours: string | null;
  closed: string | null;
  admission: string | null;
  access: string | null;
  /** その他、来場者に聞かれそうなこと（トイレ・Wi-Fi・撮影可否など） */
  notes: string[];
}

export const FACILITY: FacilityInfo = {
  name: "Mirage",
  kind: "AI受付の展示ブース",
  place: null, // 例: "神奈川県横浜市"
  hours: null, // 例: "10:00〜18:00"
  closed: null, // 例: "水曜"
  admission: null, // 例: "無料"
  access: null, // 例: "○○駅 東口から徒歩5分"
  notes: [],
};

/** システムプロンプトに差し込む施設情報。空欄は行ごと落とす。 */
export function facilityPrompt(): string {
  const lines = [
    `名前: ${FACILITY.name}（${FACILITY.kind}）`,
    FACILITY.place && `場所: ${FACILITY.place}`,
    FACILITY.hours && `開館時間: ${FACILITY.hours}`,
    FACILITY.closed && `休み: ${FACILITY.closed}`,
    FACILITY.admission && `入場料: ${FACILITY.admission}`,
    FACILITY.access && `アクセス: ${FACILITY.access}`,
    ...FACILITY.notes.map((n) => `- ${n}`),
  ].filter(Boolean);

  return (
    "【施設情報】ここに書いてあることだけを事実として答えます。\n" +
    lines.join("\n") +
    "\n書いていないこと（料金・時間など）は推測せず「スタッフに確認してください」と言います。"
  );
}
