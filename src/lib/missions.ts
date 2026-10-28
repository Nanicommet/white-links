// ── Daily kindness missions (optional, no spending required) ──

export interface Mission {
  fr: string;
  ar: string;
  icon: string; // lucide icon name
}

export const MISSIONS: Mission[] = [
  {
    fr: "Envoie un compliment sincère à ton ami secret",
    ar: "أرسل مجاملة صادقة لصديقك السري",
    icon: "Heart",
  },
  {
    fr: "Fais sourire ton ami avec une blague douce",
    ar: "أضحك صديقك بنكتة لطيفة",
    icon: "Smile",
  },
  {
    fr: "Laisse une note anonyme positive et encourageante",
    ar: "اترك رسالة مجهولة إيجابية ومشجعة",
    icon: "NotebookPen",
  },
  {
    fr: "Souhaite une excellente journée d'études ou de stage",
    ar: "تمنّح يوم دراسة أو تدريب ممتازًا",
    icon: "Sun",
  },
  {
    fr: "Partage une citation ou un mot qui fait du bien",
    ar: "شارك اقتباسًا أو كلمة تبعث الطمأنينة",
    icon: "Quote",
  },
  {
    fr: "Demande à ton ami comment se passe sa semaine",
    ar: "اسأل صديقك كيف تسير أسبوعه",
    icon: "MessageCircleHeart",
  },
  {
    fr: "Rappelle à ton ami de bien s'hydrater et de se reposer",
    ar: "ذكّر صديقك بشرب الماء والراحة",
    icon: "GlassWater",
  },
  {
    fr: "Félicite ton ami pour un effort récent, même petit",
    ar: "هنّئ صديقك على جهد صغير قام به مؤخرًا",
    icon: "Trophy",
  },
  {
    fr: "Envoie trois mots qui décrivent des qualités de ton ami",
    ar: "أرسل ثلاث كلمات تصف صفات صديقك",
    icon: "Sparkles",
  },
  {
    fr: "Partage une astuce de révision ou de bien-être",
    ar: "شارك نصيحة للمراجعة أو للراحة النفسية",
    icon: "Lightbulb",
  },
  {
    fr: "Envoie un message de courage avant un examen ou un TD",
    ar: "أرسل رسالة تشجيع قبل امتحان أو درس",
    icon: "Zap",
  },
  {
    fr: "Dis à ton ami une chose que tu admires chez lui",
    ar: "أخبر صديقك عن شيء تعجبك فيه",
    icon: "Star",
  },
  {
    fr: "Souhaite un excellent week-end avec une petite attention",
    ar: "تمنّى لنفسك نهاية أسبوع ممتازة بلطف صغير",
    icon: "Gift",
  },
  {
    fr: "Envoie un dernier message mémorable avant la révélation",
    ar: "أرسل رسالة أخيرة لا تُنسى قبل الكشف",
    icon: "MailOpen",
  },
];

export function missionForDay(gameStart: Date | null | undefined, dayIndex: number): Mission {
  if (!gameStart) return MISSIONS[0];
  void gameStart;
  return MISSIONS[dayIndex % MISSIONS.length];
}
