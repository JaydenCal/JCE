# Glide Inside: finish the Google Ads draft campaign

Prepared Mon 12/10/2026 for Jayden Callen. You do every step yourself in Google Ads; nothing here has been changed, published or paid by the agent.

- Account: **740-317-4697** (signed in as jayden.callen3@gmail.com), from the **desktop Chrome**.
- Campaign to finish: **Glide Inside | Search | Regional builders** (unpublished draft).

> **Shared account warning.** This account also runs JCE. **Do not edit, pause, enable or change the budget of**:
> - **JCE Infrastructure | Search | Regional NSW**
> - **Civil Engineering Across NSW** (Performance Max, must stay **Paused**)
>
> On 11/10 a Glide edit cut the JCE PMax budget by mistake. Before you save each change, check that the campaign name at the top of the page says "Glide Inside".

---

## 1. Clear the passkey check (2 min)
1. Open https://ads.google.com and pick account 740-317-4697.
2. If you see "Confirm it's you" or a passkey prompt, finish it on this device (phone prompt, passkey or password).
3. Go to **Campaigns** and filter to *Status: Draft* (or open **Drafts** in the left menu). Open **Glide Inside | Search | Regional builders**.

## 2. Budget and dates
1. **Campaign settings > Budget**. If you see **Campaign total budget**, set **A$250** with start date **12/10/2026** and end date **10/11/2026**.
2. If only a daily budget is offered, set **A$8.30/day**. Then **set the end date to 10/11/2026** under *Start and end dates*. (A daily budget can spend up to 2x on some days, but the monthly total stays capped at about 30.4 x daily.)
3. Bidding: **Manual CPC** or **Maximise clicks** with a **maximum CPC bid limit of A$3.00**. If ad groups use manual CPC, set each ad group's default max CPC to **A$3.00**.

## 3. Networks (Search only)
1. **Settings > Networks**: untick **Google Display Network**.
2. Untick **Google search partners** too. That's optional, but it keeps a small budget on Google Search itself.

## 4. Locations: regional Australia, no capital cities
1. **Settings > Locations > Enter another location**: add **Australia**.
2. Then **Advanced search > Exclude** these metro areas (pick the city or "metro" target, not the state):
   Sydney NSW, Melbourne VIC, Brisbane QLD, Perth WA, Adelaide SA, Hobart TAS, Darwin NT, Canberra ACT.
   (Optional: also exclude Gold Coast and Newcastle if you mean "regional" strictly. Leave them in if you want those buyers.)
3. **Location options > Include**: choose **Presence: People in or regularly in your targeted locations**. Do **not** use "Presence or interest".
4. **Exclude** option: "Presence: people in your excluded locations".

## 5. Negative keywords
**Tools > Shared library > Negative keyword lists > +** Name it **Glide Inside - negatives**, then paste one per line:

```
free
diy
software
app
download
jobs
job
career
course
training
salary
matterport
template
sketchup
autocad
revit
"3d printing"
game
```

Save. Then open **Glide Inside | Search | Regional builders > Keywords > Negative keywords > Use negative keyword list** and apply **Glide Inside - negatives** to **this campaign only**. Do not apply it to the JCE campaigns.

## 6. Check the ad copy (15 headlines, 4 descriptions)
Open the responsive search ad and check each line:
- [ ] Price shows as **$249** (not $199, $250 or "from $249" unless you mean that). No GST wording that contradicts the site.
- [ ] No "best", "#1", "cheapest", "leading" or other superlatives you can't prove (Google policy and ACCC).
- [ ] No "guaranteed" claims, and no turnaround promise unless the site states the same turnaround.
- [ ] Headlines are 30 characters or fewer and descriptions 90 or fewer (the editor flags any that are over).
- [ ] No ALL CAPS words, repeated punctuation (!!) or emoji.
- [ ] No "JCE" or civil engineering wording.
- [ ] Final URL is **https://glideinside.com.au/** (or `https://glideinside.com.au/services/display-home-virtual-tours.html` for builder ads), and it loads on your phone. The order form anchor is `#enquire`.
- [ ] If an ad mentions $249, it matches the site's scope: "$249 per home, interior only, pay when you upload".
- [ ] Ad strength is at least "Good". If it says "Poor", add more distinct headlines; don't just reword existing ones.

## 7. Link conversion actions
(Do this after the conversion_tracking files are deployed; see `conversion_tracking/DEPLOY.md`.)
1. **Goals > Conversions > Summary > + New conversion action > Website > Add manually**:
   - **Glide Inside - Purchase**: Category *Purchase*, Value *Use different values* (default **249 AUD**), Count *One*, primary action.
   - **Glide Inside - Upload started**: Category *Begin checkout* (or *Submit lead form*), Value *Don't use a value*, Count *One*, set as **Secondary** so it doesn't drive bidding.
2. For each one, open **Tag setup > Use Google tag > Install the tag yourself**. Copy the **AW-...** ID (the same for both) and each **conversion label** (the part after the slash). Paste them into `launch-config.json`. DEPLOY.md shows where.
3. In the campaign: **Settings > Goals**, choose *Use campaign-specific goals* and include **Purchase** only. That keeps JCE's lead goals from mixing into Glide bidding.

## 8. Review and Publish
1. Check the summary: A$250 total (or A$8.30/day ending 10/11), Search only, regional Australia with "People in", A$3 max CPC, negative list applied, 23 keywords, ad approved/eligible.
2. Click **Publish campaign**.
3. **Billing > Summary**: check the payment method is valid and there's no "Action required".
4. Come back in 24 hours: check *Status: Eligible*, impressions are coming in, and no policy issues.

---

## JCE ads health check (2 minutes, tick only, change nothing unless something is wrong)
Same account, **Campaigns** view, date range "Last 7 days".

- [ ] **JCE Infrastructure | Search | Regional NSW** shows *Enabled / Eligible*. (Per the 12/10 handover it was still an **unpublished draft**. If so, publishing it is your separate decision, not part of the Glide work.)
- [ ] Its budget is **A$8.00/day**.
- [ ] Locations: **12 council areas** are listed (Settings > Locations).
- [ ] Ad schedule: **Mon-Fri 7:00am-6:00pm** (Settings > Ad schedule).
- [ ] **Civil Engineering Across NSW** (Performance Max) shows **Paused**, and its budget hasn't been raised again.
- [ ] **Goals > Conversions**: JCE actions show *Recording conversions* or *No recent conversions*, not *Inactive* or *Unverified*. (The handover says JCE has no Google tag yet, so expect *Inactive* until that work is deployed.)
- [ ] **Policy manager / Ads**: no *Disapproved* or *Eligible (limited)* ads.
- [ ] **Billing**: no unpaid balance or failed payment.
