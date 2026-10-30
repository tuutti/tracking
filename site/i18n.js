// UI text in English and Finnish. The language comes from `lang` in
// config.js (or the server's PAGE_LANG), and ?lang=en / ?lang=fi in the URL overrides it.

const STRINGS = {
  fi: {
    locale: 'fi-FI',
    docTitle: 'Pyöräilyn seuranta',
    description: 'Pyöräilijöiden sijainti ja eteneminen reaaliajassa.',
    heading: 'Seuranta',
    loading: 'Ladataan…',
    map: 'Kartta',
    progressRegion: 'Eteneminen',
    language: 'Kieli',
    followRider: 'Seuraa pyöräilijää',
    followAll: 'Seuraa kaikkia',
    participants: 'Osallistujat',
    allParticipants: 'Kaikki osallistujat',
    sortBy: 'Järjestys',
    selectAll: 'Valitse kaikki',
    searchParticipants: 'Hae osallistujaa',
    noMatches: 'Ei osumia.',
    showOnMap: (name) => `Näytä kartalla: ${name}`,
    sortDistance: 'Matka',
    sortName: 'Nimi',
    sortStanding: 'Tilanne',
    checkpoints: 'Tarkastuspisteet',
    cpArrived: 'Saapui',
    cpSegment: 'Osuus',
    cpTotal: 'Yhteensä',
    startShort: 'L',
    finishShort: 'M',
    parcours: 'Pakollinen osuus',
    straightLine: 'linnuntietä tarkastuspisteiden kautta',
    hideDetails: 'Piilota tiedot',
    showDetails: 'Näytä tiedot',
    hideParticipants: 'Piilota osallistujat',
    showParticipants: 'Näytä osallistujat',
    wholeRoute: 'Koko reitti',
    rewind: 'Kelaa ajoa',
    rewindLive: 'Nyt',
    backToLive: 'Live',
    play: 'Toista',
    pause: 'Tauko',
    playbackSpeed: 'Toistonopeus',
    ofRoute: 'matkasta',
    distance: 'Ajettu',
    remaining: 'Jäljellä',
    avgSpeed: 'Keskinopeus',
    elapsed: 'Aikaa kulunut',
    speed: 'Nopeus',
    moving: 'Liikkeellä',
    stopped: 'Tauoilla',
    battery: 'Akku',
    charging: 'Latautuu',
    recentAvg: (v) => `30 min ka. ${v} km/h`,
    stoppedFor: (d) => `Pysähtynyt ${d}`,
    eta: 'Arvioitu saapuminen',
    etaNote: '(nykyisellä keskinopeudella)',
    record: 'Aiempi ennätys',

    statusLive: 'Live',
    statusNoSignal: 'Ei yhteyttä',
    statusWaiting: 'Odotetaan',
    statusFinished: 'Maalissa',
    statusRewound: 'Historia',
    statusEnded: 'Päättynyt',

    days: 'vrk',
    justNow: 'juuri nyt',
    ago: (d) => `${d} sitten`,
    lastPosition: (ago) => `Viimeisin sijainti ${ago}`,
    showingAt: (time) => `Tilanne ${time}`,
    noPositions: 'Ei vielä sijainteja',
    finishedAt: (time) => `Maalissa ${time}`,
    etaValue: (time, d) => `${time} (${d} päästä)`,

    recordPace: 'Ennätyksen tahti',
    ahead: (d) => `${d} edellä`,
    behind: (d) => `${d} jäljessä`,
    faster: (d) => `${d} nopeammin`,
    slower: (d) => `${d} hitaammin`,
    finalTime: (d) => `Loppuaika ${d}`,
    projectedTime: (d) => `Arvioitu loppuaika ${d}`,

    serverDown: (ago) => `Seurantapalvelimeen ei saada yhteyttä. Näytetään ${ago} haetut tiedot, yritetään uudelleen.`,
    serverDownNoData: 'Seurantapalvelimeen ei saada yhteyttä. Yritetään uudelleen…',
    startsAt: (time, d) => `Lähtö ${time} (${d} päästä).`,
    waitingFirst: 'Odotetaan ensimmäistä sijaintia.',
    noSignal: (d) =>
      `Viimeisin sijainti saatiin ${d} sitten. Puhelin on luultavasti katvealueella. ` +
      'Se tallentaa sijainnit, ja puuttuvat sijainnit tulevat näkyviin, kun yhteys palaa.',
    offRoute: (km) => `Poikettu suunnitellulta reitiltä (${km} km). Matkan laskenta jatkuu, kun palataan reitille.`,
    routeError: (msg) => `Suunniteltua reittiä ei voitu ladata (${msg}).`,
    noEvent: 'Tapahtuma puuttuu: lisää osoitteeseen ?event=<tunnus>.',
  },

  en: {
    locale: 'en-GB',
    docTitle: 'Live ride tracker',
    description: 'Live position and progress of the riders.',
    heading: 'Live tracker',
    loading: 'Loading…',
    map: 'Map',
    progressRegion: 'Ride progress',
    language: 'Language',
    followRider: 'Follow rider',
    followAll: 'Follow everyone',
    participants: 'Participants',
    allParticipants: 'All participants',
    sortBy: 'Sort by',
    selectAll: 'Select all',
    searchParticipants: 'Search participants',
    noMatches: 'No matches.',
    showOnMap: (name) => `Show on the map: ${name}`,
    sortDistance: 'Distance',
    sortName: 'Name',
    sortStanding: 'Standing',
    checkpoints: 'Checkpoints',
    cpArrived: 'Arrived',
    cpSegment: 'Segment',
    cpTotal: 'Total',
    startShort: 'S',
    finishShort: 'F',
    parcours: 'Parcours',
    straightLine: 'straight line via the checkpoints',
    hideDetails: 'Hide details',
    showDetails: 'Show details',
    hideParticipants: 'Hide participants',
    showParticipants: 'Show participants',
    wholeRoute: 'Whole route',
    rewind: 'Rewind the ride',
    rewindLive: 'Now',
    backToLive: 'Live',
    play: 'Play',
    pause: 'Pause',
    playbackSpeed: 'Playback speed',
    ofRoute: 'complete',
    distance: 'Distance',
    remaining: 'Remaining',
    avgSpeed: 'Avg speed',
    elapsed: 'Elapsed',
    speed: 'Speed',
    moving: 'Moving',
    stopped: 'Stopped',
    battery: 'Battery',
    charging: 'Charging',
    recentAvg: (v) => `30 min avg ${v} km/h`,
    stoppedFor: (d) => `Stopped for ${d}`,
    eta: 'ETA',
    etaNote: '(at current average)',
    record: 'Previous record',

    statusLive: 'Live',
    statusNoSignal: 'No signal',
    statusWaiting: 'Waiting',
    statusFinished: 'Finished',
    statusRewound: 'History',
    statusEnded: 'Ended',

    days: 'd',
    justNow: 'just now',
    ago: (d) => `${d} ago`,
    lastPosition: (ago) => `Last position ${ago}`,
    showingAt: (time) => `As of ${time}`,
    noPositions: 'No positions yet',
    finishedAt: (time) => `Finished ${time}`,
    etaValue: (time, d) => `${time} (in ${d})`,

    recordPace: 'Record pace',
    ahead: (d) => `${d} ahead`,
    behind: (d) => `${d} behind`,
    faster: (d) => `${d} faster`,
    slower: (d) => `${d} slower`,
    finalTime: (d) => `Finished in ${d}`,
    projectedTime: (d) => `Projected finish time ${d}`,

    serverDown: (ago) => `Can't reach the tracking server. Showing data from ${ago}, retrying.`,
    serverDownNoData: "Can't reach the tracking server. Retrying…",
    startsAt: (time, d) => `The ride starts ${time} (in ${d}).`,
    waitingFirst: 'Waiting for the first position.',
    noSignal: (d) =>
      `No position for ${d}. The phone is probably out of mobile coverage. ` +
      'It keeps recording and the missing positions will appear once it reconnects.',
    offRoute: (km) => `Currently ${km} km off the planned route. Distance resumes once back on route.`,
    routeError: (msg) => `Couldn't load the planned route (${msg}).`,
    noEvent: 'No event given: add ?event=<id> to the address.',
  },
};

export const LANGUAGES = Object.keys(STRINGS);

// ?lang= in the URL wins, then the viewer's earlier choice, then config.js.
export function pickLanguage(configured, urlParam, remembered = null) {
  if (LANGUAGES.includes(urlParam)) return urlParam;
  if (LANGUAGES.includes(remembered)) return remembered;
  return LANGUAGES.includes(configured) ? configured : 'en';
}

export const strings = (lang) => STRINGS[lang];

// A config text is either a plain string or { en: '…', fi: '…' }; a missing
// language falls back to English, then to whichever is given.
export function localized(value, lang) {
  if (value && typeof value === 'object') return value[lang] ?? value.en ?? Object.values(value)[0] ?? '';
  return value ?? '';
}

// Fills static markup: data-i18n sets text, data-i18n-aria sets aria-label.
export function translatePage(T, lang) {
  document.documentElement.lang = lang;
  document.querySelector('meta[name="description"]')?.setAttribute('content', T.description);
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = T[el.dataset.i18n];
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', T[el.dataset.i18nAria]);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = T[el.dataset.i18nPlaceholder];
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = T[el.dataset.i18nTitle];
}
