# Bloom

A running total for the shops. You type `chicken` `10`, the counter drops by ten,
and the chicken slides into its place in the list — under the thing that cost 15,
above the thing that cost 5.

Built as a single static page: no accounts, no server, no tracking. Everything
lives on your phone.

---

## Putting it on your phone

**1. Turn on GitHub Pages** (once)

Merge this branch into `main`, then in the repo go to
**Settings → Pages → Build and deployment**, set *Source* to **Deploy from a
branch**, branch **`main`**, folder **`/ (root)`**, and Save. A minute later the
site is live at:

```
https://dzpypjfzh5-lgtm.github.io/Shopping-Assistant/
```

**2. Add it to your Home Screen** (please do this)

Open that link in Safari on the iPhone → tap **Share** → **Add to Home Screen**.

This is not just a shortcut. It matters for two reasons:

- **Offline.** Supermarket signal is dreadful. Installed, the whole app is cached
  and works with no bars at all.
- **Your data survives.** Safari clears a normal website's stored data after
  about seven days of not visiting. A home-screen app is exempt. If you only ever
  use it through the browser tab, a fortnight's gap could wipe your history.

---

## Using it

**Adding things.** Type the name, tap the price box, tap **+**. The keyboard
stays up so you can keep going down the aisle.

Shortcuts that save a tap:

- Type `chicken, $10` (or `chicken 10`) in the name box alone and hit go — it
  splits it for you.
- The price box does sums: `4.50*2` for two at £4.50, `1.20+0.80` for odds and ends.
- Start typing something you have bought before and it tells you what you paid
  last time, with a **Use it** button.

**Fixing things.** Tap any row to change the name or price. Tap the **×** to
remove it — there is an **Undo** for a few seconds afterwards.

**Sorting.** Priciest first by default. The chips switch to cheapest first,
newest, or alphabetical.

**The counter.** Big number is what's left. Below it, what you've spent and the
budget (tap the budget to change it). Scroll down a long list and a slim version
of the counter sticks to the top so the number is never out of sight. The sky
behind it drifts from sunrise to sunset as the budget goes down; going over
turns the number to *Over by* and nothing scolds you.

**Finishing.** Tap **Finish this shop** at the till. It moves to History and the
basket starts empty at your full budget.

**Last week.** On the shop screen there's a **Last shop** panel with everything
you bought last time and what it cost. Tap any line to drop it into the add box
at last week's price — handy at the shelf, and handy at home when you're writing
this week's list. The History tab has the same for every shop you've finished,
plus your last total, your average and how many shops you've logged.

---

## Getting it onto a computer

**Data → Send a copy somewhere.**

- **Share CSV** opens the iPhone share sheet. From there it goes straight into
  Files, Google Drive, Notion, Mail, Messages, wherever. CSV opens in Numbers,
  Excel or Google Sheets — one row per item, with the shop date, price, budget
  and shop total.
- **Share backup** does the same with a `.json` file. That's the one that can be
  put *back* into the app (**Restore a backup**), so it's the one worth keeping
  if you want a safety net.

There is deliberately no automatic Google Drive or Notion sync. Doing it properly
needs a server holding an API key; doing it improperly means putting a secret in
a public repo. The share sheet gets a file into either app in two taps and
nothing can leak. If you later want it to sync by itself, that's a real backend
and worth deciding on separately.

---

## Where the data actually is

In this app's own storage on this device, under the key `bloom.v1`. It never
leaves the phone unless you share or download it. A rolling backup copy is kept
under `bloom.v1.backup`, and if the main record is ever unreadable it is set
aside rather than deleted, so nothing is silently thrown away.

The honest limits:

- **It's one device.** Nothing syncs between your phone and anything else.
- **Deleting the app from your Home Screen deletes the data with it.** Take a
  backup before you do that.
- **Clearing Safari's website data clears this too.**

So: download a backup now and then, especially before iOS updates or if you're
changing phones. Two taps in the Data tab.

---

## Files

| | |
|---|---|
| `index.html` | Markup for all three screens |
| `styles.css` | The whole look: palette, sunrise header, flowers |
| `app.js` | State, storage, sorting, export, import |
| `sw.js` | Service worker, so it runs with no signal |
| `manifest.webmanifest` | Makes it installable |
| `icons/` | Home-screen icons |

No build step and no dependencies. Open `index.html` in a browser and it runs.

To poke at it locally:

```bash
python3 -m http.server 8000
# then http://localhost:8000
```

(A plain `file://` open mostly works, but service workers need a real server.)
