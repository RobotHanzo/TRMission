import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/tutorial';

export default {
  title: 'Tutorial',
  intro: 'Learn TRMission by playing. Choose how much to cover:',
  full: 'Full tutorial',
  fullDesc:
    'Covers everything: drawing, claiming routes, ferries & tunnels, stations, tickets, the longest route, and final scoring.',
  quickstart: 'Quickstart',
  quickstartDesc: 'Just the core loop: draw, claim routes, tickets, and scoring.',
  exit: 'Exit',
  next: 'Next',
  prevLesson: 'Previous',
  nextLesson: 'Next lesson',
  finish: 'Finish',
  replay: 'Replay',
  play: 'Play',
  pause: 'Pause',
  yourTurn: 'Your turn',
  watching: 'Watch…',
  payHint: 'Pick a matching set of cards below to complete the payment.',
  prevStep: 'Back',
  nextStep: 'Forward',
  open: 'Encyclopedia',
  indexHint: 'Each topic plays out on the board as a short demo — pause or step through any time.',
  contents: 'Contents',
  steps: '{{n}} steps',
  createGame: 'Create your first game',
  finalTitle: 'Tutorial complete!',
  finalBody:
    "You've learned all the rules of TRMission. Create your first game and start playing against friends or bots!",

  welcome: {
    title: 'Welcome',
    blurb: 'The goal and the basics.',
    goal: 'Welcome to TRMission! Build railways across Taiwan and complete secret mission tickets — the highest score wins.',
    map: 'This is the board: 46 cities (39 on the main island + 7 islands) joined by routes. Drag and zoom to explore.',
    score:
      'Points come from four places: routes you claim, mission tickets you complete, a bonus for unused stations, and the longest continuous railway.',
    draft:
      "First, choose mission tickets. You're dealt 1 long + 3 short; keep at least 2 (all long tickets must be kept). Pick on the right and confirm.",
    botdraft: 'Your opponent has chosen their tickets too.',
  },
  draw: {
    title: 'Drawing cards',
    blurb: 'Take up to two train cards per turn.',
    intro: 'One action is drawing train cards. Five are face-up; beside them is the blind deck.',
    do: 'Draw a train card — click a face-up card, or draw from the deck.',
    second: 'A draw turn normally takes two cards: after the first, you may take a second.',
    loco: "The locomotive is wild: taking a face-up locomotive uses your whole turn (no second card), and it can't be your second face-up card.",
  },
  claim: {
    title: 'Claiming routes',
    blurb: 'Pay matching cards to take a route and score at once.',
    intro:
      'To claim a route: click it on the map, then pay train cards equal to its length, all of one colour (locomotives are wild). Gray routes accept any single colour. Each segment costs one train car.',
    try: 'Your turn: click the highlighted Pingdong–Chaozhou route on the map to claim it.',
    scored: 'A claimed route scores immediately by length and shows in your seat colour.',
    table: 'Longer routes score far more: 1→1, 2→2, 3→4, 4→7, 6→15, 8→21 points.',
  },
  special: {
    title: 'Special routes',
    blurb: 'Double, ferry, and tunnel routes.',
    intro:
      'Routes come in three kinds: ordinary railways, sea ferries, and mountain tunnels. Compare how they look below:',
    double:
      'Double routes: two parallel lines between two cities. With 2–3 players, claiming one locks the other; with 4–5, both stay open. You can never own both of a pair.',
    ferry:
      'Ferry routes (to the islands): your payment must include enough locomotives — the icons show how many.',
    tunnel:
      'Tunnel routes: after you claim, 3 cards are revealed; for each one matching your paid colour (or a locomotive) you must pay one extra of that colour or a locomotive — or abort (your cards stay in hand).',
    broken:
      "Broken rails (on some maps): a damaged stretch (marked by a crack) can't be claimed until repaired. Spend a turn paying cards equal to the damaged length in the route's colour (any one colour on gray; locomotives wild) to repair it and score that length immediately — no trains placed. The repairer alone may claim it until the end of their next turn; after that, anyone may.",
  },
  stations: {
    title: 'Stations',
    blurb: 'Build a station to borrow rival routes at game end.',
    what: "To build a station: click a city on the map, then pay train cards. At game end a station 'borrows' the rival routes there to help connect a ticket. One station per city.",
    cost: 'A station is paid in a single colour: 1 card for your first, 2 for the second, 3 for the third (locomotives wild).',
    try: 'Your turn: click the highlighted Taipei on the map to build a station there.',
    bonus:
      'Each unused station is worth +4 at game end — so building one gives up that bonus. Build only when it saves a ticket.',
    specimenBuilt: 'Station built',
    specimenEmpty: 'No station',
    cost1: '1st = 1 card',
    cost2: '2nd = 2 cards',
    cost3: '3rd = 3 cards',
  },
  tickets: {
    title: 'Mission tickets',
    blurb: 'Connect two cities to score; fail and you lose those points.',
    complete:
      'A ticket names two cities; connect them with an unbroken chain of YOUR routes (or via a station borrow at game end) to score its points. Tickets are secret until the end.',
    penalty: 'Careful: an unfinished ticket SUBTRACTS its points.',
    more: 'You can spend a turn to draw 3 more tickets, keeping at least 1.',
    forced:
      'Once ALL your kept tickets are complete, your turn opens straight into a forced ticket draw — you always have an objective to chase.',
  },
  longest: {
    title: 'Longest route',
    blurb: 'The longest continuous route earns +10.',
    trail:
      'At game end the player with the longest continuous route (never reusing a segment) earns +10; ties go to the earliest player in turn order.',
  },
  endgame: {
    title: 'Endgame & scoring',
    blurb: 'When the game ends and how the final score is tallied.',
    trigger:
      'When a player drops to 2 or fewer train cars, the endgame triggers: that player and everyone else take one final turn.',
    scoring:
      'Final score = route points (already tallied) + ticket net (completed minus failed) + station bonus (+4 each unused) + longest route (+10).',
    win: 'Highest total wins; ties break by most tickets completed, then fewest stations used, then holding the longest route.',
  },
  glossary: {
    rail: 'Railway',
    ferry: 'Ferry',
    tunnel: 'Tunnel',
    broken: 'Broken rail',
  },
  featureIntro: {
    heading: 'Special rules on this map',
    skip: 'Skip',
    done: 'Got it',
    pageOf: 'Page {{page}} / {{total}}',
    brokenRail: {
      title: 'Broken rail',
      what: 'This map has broken rails: a damaged stretch of track (marked by a crack) cannot be claimed by anyone until it has been repaired.',
      repair:
        "Spend a full turn to repair it: pay train cards equal to the damaged length, in the route's colour (any one colour on gray routes; locomotives are wild), and score immediately as if you had built a route of that length — no train cars are placed.",
      exclusive:
        'The repairer holds exclusive claim rights until the end of their own next turn; after that window, any player may claim the route.',
    },
  },
  chapters: {
    c0: 'Basics',
    c3: 'Drawing',
    c4: 'Routes',
    c5: 'Special routes',
    c6: 'Stations',
    c7: 'Tickets',
    c8: 'Longest trail',
    c9: 'Endgame',
  },
} satisfies TranslationShape<typeof zh>;
