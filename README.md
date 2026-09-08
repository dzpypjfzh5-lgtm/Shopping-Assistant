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

Because that is the one thing that can actually lose your data, the app reminds
you. A small panel appears under the add box with a **Show me how** walkthrough,
but only once there is something to lose (the first item in the basket, the
first line on the shopping list, or a saved shop) and never on an empty first
run. **Not now** puts it away for five
days. It stops for good once you are running from the Home Screen, and the same
note stays permanently in the Data tab if you want it earlier.

---

## Using it

**Adding things.** Type the name, tap the price box, tap **+**. The keyboard
stays up so you can keep going down the aisle.

Shortcuts that save a tap:

- Type `chicken, $10` (or `chicken 10`) in the name box alone and hit go — it
  splits it for you.
- The price box does sums: `4.50*2` for two at £4.50, `1.20+0.80` for odds and ends.
- Start typing and it offers things you have bought before, with what they cost
  last time. Tap one and the name and the price are both filled in; change the
  price if it has moved. Tapping the empty name box offers your usual suspects,
  the things you buy most and most recently. Arrow keys and Enter work if you
  have a keyboard.

**The shopping list.** The panel under the add box is what you need, as opposed
to what is already in the basket. Write it at home, tap the lines in the shop.

- Add a line by name (`milk`), or with a price you already know (`milk, 1.20`).
- Tap a line and it drops into the add box with a price on it: last week's price,
  or the one you noted. Put the real price on it and tap **+**, and it counts
  towards this shop like anything else.
- Anything you add to the basket ticks itself off the list, whether you tapped
  the line or just typed it in. Tap a ticked line to untick it.
- **Finish this shop** clears the ticked lines and keeps the rest, so what you
  could not find is still there next week.
- Every line in **Last shop** and in History has a small list button on the
  right, for building next week's list off the sofa.

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

**Unspent budget.** History also keeps a running total of what you did *not*
spend. Every finished shop counts the gap between its budget and its total, and
the card adds them up: how much you have kept back overall, what that averages
per shop, and how often you came in under. The columns are one shop each, oldest
on the left, above the line for money left over and below it for going over. It
is the same number the CSV carries in its **Left over** column.

---

## Getting it onto a computer

**Data → Send a copy somewhere.**

- **Share CSV** opens the iPhone share sheet. From there it goes straight into
  Files, Google Drive, Notion, Mail, Messages, wherever. CSV opens in Numbers,
  Excel or Google Sheets — one row per item, with the shop date, price, budget,
  shop total and what was left over.
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

**What it takes not to lose the shop you are in.** Every item goes to disk the
moment it lands in the basket, and again when the app is backgrounded or closed.
The thing you are half way through typing is kept too, so an app the phone
decided to kill comes back with `salmon 8.5` still sitting in the box. The
rolling backup copy is a real fallback: if the main record is ever damaged the
app reads the backup instead and tells you it did, keeping the damaged copy
aside rather than binning it. And if you have Bloom open twice at once (a Safari
tab and the Home Screen app share one store), the two baskets are merged rather
than one silently overwriting the other.

The honest limits:

- **It's one device.** Nothing syncs between your phone and anything else.
- **Merging two open windows is deliberately generous.** It keeps everything from
  both, so something you deleted in one window can reappear. Deleting it again
  takes a second; a lost basket at the till does not.
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
| `app.js` | State, storage, shopping list, suggestions, sorting, export, import |
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
