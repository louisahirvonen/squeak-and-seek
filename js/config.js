// Supabase project settings. Both values are public by design (safe to commit).
window.SQUEAK_CONFIG = {
  supabaseUrl: 'https://fnjcofdkfwqnczirfpax.supabase.co',
  supabaseKey: 'sb_publishable_3h9HehX23kSw8BBRRzsOvw_mjJ11mWG',
  birthdayName: 'Louisa',
  birthdayAge: 24,
  questionsFile: 'questions.json',
  // The last question is worth double (only when the quiz has 3 or more questions). Set to false to turn off.
  doubleFinal: true,
  // "Bet your cheese": before the last question everyone bets part of their score on getting it right.
  // Takes the place of the double-points final. Set to false to go back to double points.
  wagerFinal: true,
  // The answer screen and the leaderboard move on by themselves after this many seconds (0 = only when the host clicks).
  autoAdvanceSeconds: 20,
};
