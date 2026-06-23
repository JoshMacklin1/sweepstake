// Pulls in GROUPS + ownerOfTeamCode so goal notifications can say "Henry's
// Netherlands scores!" instead of just the team name — scoring.js stays the
// single source of truth for roster data; nothing is duplicated server-side.
try {
  importScripts('./scoring.js');
} catch (err) {}

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());

self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('')));
});

function buildGoalNotification(data) {
  let owner;
  try {
    if (typeof GROUPS !== 'undefined' && typeof ownerOfTeamCode === 'function') {
      const players = GROUPS?.[data.groupKey]?.players;
      if (players) owner = ownerOfTeamCode(data.code, players);
    }
  } catch (err) {}

  return {
    title: owner ? `⚽ ${owner}'s ${data.scoringTeam} scores!` : `⚽ GOAL — ${data.scoringTeam}`,
    body: `${data.home} ${data.hs}-${data.as} ${data.away}`,
  };
}

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}

  const built = data.type === 'goal' ? buildGoalNotification(data) : null;
  const title = built?.title || data.title || 'Sweepstakes';
  const body = built?.body || data.body || '';

  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag,
    data: data.data || {},
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
