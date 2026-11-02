-- A fixed deposit amount (e.g. £50 to secure a cake date). When set, it replaces deposit_percent.
ALTER TABLE quotes ADD COLUMN deposit_fixed_pence INTEGER;

-- SOP answers from the owner (2 Nov 2026): deposits, £55 design collections, banned word, travel start, cake collection.
UPDATE sop SET content = '# Beyond Scrumptious Quoting SOP

This covers **cakes** and the **live dessert stations** (Live Mini Pancake Station and Live Croffle Station). Work out which one the enquiry is about first, then use only that section''s rules. Never carry rates or rules from one product to another.

## How to use this SOP in the app

- **Prices come only from the Price list.** Pick the item whose name matches the size, band or package. If something has no price on the list, or the price "depends", add it as a custom line marked for review. Never estimate it.
- **Owner approval:** if any of the owner-approval triggers below apply, start the internal notes with `OWNER APPROVAL NEEDED:` and say why. Mark the affected lines for review.
- **Missing information:** put everything that''s missing in "Still to ask the client". The WhatsApp reply should ask the client **one clear question at a time** (the most important one first). Never ask for something the client has already given.
- **Provisional quotes:** if there''s enough information to calculate a provisional quote, calculate it and say clearly in the reply what is still to be confirmed.
- **Confidential:** internal costs, labour valuations, allowances, margins and supplier prices go in internal notes only. They must never appear in client notes or the WhatsApp reply.
- **Not a booking:** a quote is never a booking confirmation. Never say a date is booked or reserved.
- **Deposits:** use only the deposit rules in this SOP (A6 for cakes, B5 for stations). Set the quote''s deposit to match, and state it in the reply. Where no rule applies, set no deposit and flag it for the owner. Never invent one.
- **Discounts:** never reduce a price because the client asks. Quote the normal price and flag the discount request for the owner. For charity, Mandir, community or special-relationship enquiries, quote the normal public price and flag it for the owner.

---

# Part A: Cakes

## A1. Information to collect

- Customer name and preferred contact method
- Occasion and event date
- Collection date and preferred pickup time
- Number of guests or intended servings
- Cake size and number of layers (if known)
- Sponge flavour and filling
- Design description, theme and colour palette
- Wording, name, age and topper requirements
- Reference photos or inspiration images
- Dietary requirements and restrictions

Don''t finalise a quote while details that affect size, design or extras are still unclear.

## A2. Choosing the cake and price list

There are two base price lists. Pick the right one:
- **Standard** ("Cakes – Standard" items)
- **Naturally Sweetened** ("Cakes – Naturally Sweetened" items). Use this only when the client asks for the naturally sweetened range.

The usual offer starts at a **6-inch, 3-layer** cake. A **6-inch, 2-layer** cake is an exception and should only be offered where appropriate. Mention it in internal notes if you use it.

## A3. Flavours and fillings

- **Classic sponges:** Vanilla, Chocolate, Raspberry, Marble
- **Deluxe sponges:** Oreo, Biscoff, Kulfi, Black Forest (cherry jam filling). The Black Forest fresh-cream version is only available in 2 layers, subject to availability and suitability.
- **Classic fillings:** Vanilla buttercream, Chocolate buttercream
- **Deluxe fillings:** Strawberry jam with vanilla buttercream, Raspberry jam with vanilla buttercream, Cherry jam with vanilla buttercream, Oreo buttercream, Oreo fresh cream
- **Outside icing:** Vanilla buttercream, Chocolate buttercream, Oreo buttercream

Fresh cream and some fillings depend on availability and the sponge. Flag them for review before including them.

**Deluxe flavour surcharge:** add the 6-inch or 8-inch deluxe flavour surcharge only for a deluxe sponge on the **standard** range. The naturally sweetened range has no defined deluxe surcharge. Don''t apply the standard one; add a custom line for review instead.

## A4. Extras and design

- Happy Birthday wording is included in the base price (no charge).
- Toppers, added fruit and Happy Birthday + name/age wording are on the price list. Use the **bundle** item when the client wants both a name topper and an age topper, instead of charging them separately.
- **Decorative elements** are charged per element by size. If there are 3 or more elements of the same size, use the "3 or more" rate for all of them.
- **Acrylic toppers** start from £10, but the price depends on the actual item cost plus shipping. Always add them as a custom line for review.
- **Design collections:**
  - The Simple yet Elegant collection starts at £55, with limited décor/effects; personalised toppers are extra.
  - Celebration cakes start at £55 for 6-inch and 8-inch (2 layers and above); décor and toppers are extra.
  - Kids'' themed celebration cakes start at £55 for 6-inch and 8-inch (2 layers and above); décor and toppers are extra.
  - These are "from" prices, not extra charges. The base cake price covers them, so don''t add a separate collection line. Price the cake from the size list, then add décor and toppers.
- **Custom or unusually detailed designs:** the extra design work must be priced by the owner. Add a custom line for review.

## A5. Calculating the quote

Total = base cake + flavour surcharge (if applicable) + filling/finish extras + toppers + decorative elements + fruit + any agreed custom-design charge.

Only charge for what is in the client''s actual specification. Don''t double-charge anything already included in the base design or an agreed collection price.

## A6. Cake payment

- **Total under £100:** full payment is needed to confirm the order. Set the deposit to 100%.
- **Total £100 or more:** a £50 deposit secures the date (set a fixed deposit of £50). The balance is due 1 week before the collection date.
- Put the payment terms in the client notes and in the reply, e.g. "A £50 deposit secures your date, with the balance of £X due by [date one week before collection]."
- If staff change the cake so the total crosses £100, the deposit needs updating to match.

## A7. Cake collection

Cakes are collected from **40 Winchester Road, HA3 9PE**. Use this in the Pickup Details.

## A8. Customer reply (WhatsApp) for cakes

Warm, professional and clear. Use this format:

```
Hi [Customer Name],

Thank you for your enquiry!

Here is your quote for the cake:

Cake Details
Size: [e.g. 6-inch, 3 layers]
Occasion: [Occasion]
Servings: [Approximate servings, only if confirmed]
Flavour: [Sponge flavour]
Filling: [Filling]
Outside icing: [Icing]
Design: [Clear description of design and personalisation]
Additional extras: [List extras, or "None"]

Total Price: £[XX.XX]

Pickup Details
Date: [Date]
Time: [Agreed time]
Collection: 40 Winchester Road, HA3 9PE

Payment: [Full payment to confirm the order / £50 deposit to secure the date, balance of £[X] due by [date]]

Please let me know if you would like to go ahead or make any changes.

By confirming your order, you are agreeing to our terms and conditions. They can be found here: https://www.beyondscrumptious.com/terms-and-conditions. If you require a PDF copy, please let us know.

Thank you,
Naavyen
Beyond Scrumptious
```

If information is still missing, send a short friendly message asking the single most important question instead of a full quote, or give a provisional quote with the question at the end.

## A9. Cake checks before sending

- Correct price list (standard or naturally sweetened)
- Correct size and layer count
- 6-inch 3-layer minimum followed; 6-inch 2-layer only as an exception
- Flavour surcharge only where relevant and supported by the price list
- Toppers, fruit and decorative elements priced correctly
- Design described accurately, with any uncertainty resolved
- Date, pickup time and collection details correct
- Payment terms correct (full payment under £100; £50 deposit and balance 1 week before at £100 or more)
- Terms and conditions statement included

---

# Part B: Live dessert stations

Covers the **Live Mini Pancake Station** and the **Live Croffle Station**. Each has its own pricing basis.

## B1. Information to collect

- **Event:** date, event type, approximate guest count (pancakes) or croffle quantity (croffles)
- **Location:** venue name/address or postcode; parking, tolls and access restrictions
- **Station and package:** Pancake or Croffle; Classic, Deluxe or Signature
- **Service:** preferred serving time, service duration, number of service periods, expected guest flow
- **Selections:** toppings and sauces; whether pistachio or other premium selections are wanted
- **Customisation:** hanging ring sign, event-logo tabletop plaque, custom machine front board, other bespoke items
- **Dietary/venue:** allergies, power, table/working space, outdoor shelter, anything unusual
- **Multiple bookings:** several events on the same day or at the same venue

## B2. Live Mini Pancake Station: pricing

The price is a **flat package price per booking**, set by the guest band and package. It is not per guest. Use the matching "Pancake Station" item with quantity 1.

- **Guest bands:** 1–50, 51–100, 101–150, 151–200, 201–250, 251–300. Move to the next band as soon as the guest count goes over the previous band (e.g. 51 guests → 51–100).
- **Minimum charge:** the 1–50 band price. Never pro-rate smaller events.
- **More than 300 guests:** bespoke. Don''t extend the table; flag for owner approval.
- **Packages are fixed:** Classic = 2 toppings + 2 sauces; Deluxe = 4 + 4; Signature = 6 + 6. Never remove toppings or sauces in exchange for a discount, or create a custom package, without approval.

Total = package price + approved premium add-ons + travel + approved customisation/extras.

**Toppings and sauces:**
- **Standard toppings:** Oreo crumbs, Biscoff crumbs, sprinkles, mini marshmallows, Smarties
- **Standard sauces:** milk chocolate, white chocolate, Biscoff, mango
- **Premium toppings:** kunafa, fresh chopped strawberries, cake pieces, hazelnuts, pistachios
- **Premium sauces:** cookies & cream, pistachio, chocolate hazelnut
- Classic: 2 standard toppings + 2 standard sauces only. Premium selections can''t be swapped into Classic.
- Deluxe: 4 toppings + 4 sauces from the wider range. The owner may adjust the permitted premium mix.
- Signature: 6 toppings + 6 sauces from the full selection, subject to availability and any separately designated premium add-ons.

**Pistachio:** add the pistachio add-on (per booking) when the client asks for pistachio as a premium add-on. Don''t add it automatically if pistachio is already within an approved package. Pistachio is not automatically included in Deluxe or Signature. Whenever a client chooses it within Deluxe or Signature, add the line and mark it for review so the owner can confirm.

**Travel:** mileage is measured from **HA3 9PE**. The first 5 miles are included. Beyond 5 miles, use the "Pancake Station travel" item per mile beyond the first 5. The rate is the current HMRC mileage rate + 5p, so mark the line for review if the rate may be out of date. You can''t look up driving distances, so always add the travel line with quantity 0 (or the client''s stated mileage), mark it for review, and note in internal notes that the mileage from HA3 9PE to the venue must be checked. Parking, tolls and other unavoidable costs are charged separately where they apply and must be confirmed. Never guess them.

**Customisation:** hanging ring sign, event-logo tabletop plaque and custom machine front board are paid extras with no approved price yet. Add each one as a custom line at £0 marked for review, and describe it to the client as "Additional charge — price to be confirmed".

## B3. Pancake station: operations (for internal notes)

- **Service duration:** up to 150 guests = 2 hours; 151–300 guests = 2.5 hours; over 300 = bespoke. Maximum normally offered: 3.5 hours.
- **Staffing:** normally 2 people; 3 from 251 guests. The owner may add staff earlier. Staffing is an internal decision; don''t mention it to clients.
- **Serving model:** freshly cooked mini pancakes served throughout the booked service period. **Never promise unlimited quantities.**
- **Production benchmark (internal only):** 4 mini pancakes per guest. Normally one machine in use, with a second as backup. About 50 pancakes per batch, 5–10 minutes per batch. One 900ml batter bottle makes about 110 mini pancakes.

**Internal cost assumptions. Confidential: internal notes only.**
- Labour valuation: £15 per hour per worker, including the owner''s time
- Food and disposables allowance: £0.75 per guest (a planning allowance, not a measured cost)
- Equipment/operating allowance: £15 per event
- Travel: £0.50 per mile beyond the first 5 miles (HMRC rate + 5p)

**Profitability check:** in internal notes, give a rough cost estimate using these assumptions (labour = staff × service hours × £15, food = guests × £0.75, + £15 equipment, + travel). Setup and packdown time aren''t in this estimate; say so and the resulting margin. Flag the quote for the owner if the margin looks unusually low or commercially unviable. Never reduce a price for this; the owner decides.

## B4. Live Croffle Station: pricing

Croffles are charged **per croffle**: not per guest, and not unlimited. Always state the number of croffles included.

- **Chargeable quantity** = the greater of the requested quantity and **50** (the minimum), up to a maximum of **200**.
- **More than 200 croffles:** outside the approved range. Don''t quote automatically; flag for owner approval.
- Use the "Croffle Station" item for the package and the band the chargeable quantity falls in (50–75, 76–100, 101–150, 151–200), with the quantity set to the chargeable quantity.
- **Packages:** Classic = 2 toppings + 2 sauces; Deluxe = 4 + 4; Signature = 6 + 6. Fixed: never remove inclusions in exchange for a discount.
- Croffle topping and sauce selections have no standard/premium classification yet. Confirm selections and any premium surcharge with the owner.
- **Croffles are eggless.** Never describe the station as vegan or promise a vegan option unless it has been separately confirmed.
- **No approved croffle travel fee or customisation prices.** Never borrow the pancake mileage rule or invent a fee. Add such items as custom lines for review.
- **Quantity changes:** before confirmation, recalculate whenever the quantity changes (reapply the minimum, recheck the band and rate). The client must confirm the final quantity at least 14 days before the event. After that, reductions don''t reduce the agreed price, and increases need owner approval.
- **Venue checks:** a 6ft table, power within about 5 metres, outdoor shelter/shade, and 30–45 minutes for setup.

## B5. Station payment

- **Live Mini Pancake Station:** 25% deposit to secure the date. Set the deposit to 25% and state the amount in the reply.
- **Live Croffle Station:** no deposit rule has been set. Set no deposit, and flag it for the owner in internal notes.

## B6. Owner-approval triggers (both stations)

- More than 300 pancake guests or more than 200 croffles
- Service longer than the standard duration, over 3.5 hours, multiple service periods or unusual staffing
- Unusual venue or access requirements, unusually long travel, significant parking/toll costs or bespoke equipment
- Customisation without an approved price; unusual food or dietary requirements
- Discount requests, charity/community/special rates, prices below the model, or unclear premium ingredient treatment
- Any conflict, missing pricing rule or uncertainty in this SOP

## B7. Customer reply (WhatsApp) for stations

Warm, professional, concise and confident. Never say "cost"; use "investment", "quote", "package price" or "total". Use "Live Pancake Station", "Live Mini Pancake Station", "mini pancakes" or "freshly cooked mini pancakes". **Never use the word "Dutch"** for the pancakes, even if the client does.

**Pancakes:**
```
LIVE MINI PANCAKE STATION
Event: [Event type]
Date: [Date]
Venue: [Venue / location]
Guests: [Number]
Service: [2 / 2.5 hours]
Package: [Classic / Deluxe / Signature]

Included
• Freshly cooked mini pancakes served throughout the booked service period
• [2 / 4 / 6] toppings
• [2 / 4 / 6] sauces
• Live cooking and serving
• Standard setup and packdown

Investment: £[total]
Additional: [Travel / approved premium extras / customisation, where applicable]
Deposit: £[25% of total] to secure the date
```

**Croffles:**
```
LIVE CROFFLE STATION
Event: [Event type]
Date: [Date]
Venue: [Venue / location]
Quantity: [Number] croffles
Package: [Classic / Deluxe / Signature]
Rate: £[rate] per croffle
Base price: £[base]
Approved additions: [Details / none]
Total quotation: £[total]
```

Every station reply must also say:
- The quote is valid for **7 days**.
- It is **not a booking confirmation**. Availability and prices are only guaranteed once the booking is accepted, availability is confirmed and the required payment is received. A Booking Agreement may be needed for bookings of £300 or more or for live services.
- What happens next.

## B8. Booking and changes (for reference in replies)

- Once confirmed, the price changes only if the client adds products or services, changes guest numbers or service requirements, or additional costs arise and are agreed.
- For live stations, changes requested within 14 days of the event can''t be guaranteed.
- Setup and packdown time are separate from the serving period. Extra serving time on the day depends on staff availability and may cost extra.
- For outdoor events, the client must arrange shelter from rain, heat, direct sun and strong wind.
- Confirm dietary/allergy requirements in writing before accepting a booking. Never promise allergen-free service or a separate cooking surface unless agreed and confirmed.
', updated_by = 'owner answers 2 Nov 2026', updated_at = datetime('now') WHERE id = 1;
INSERT INTO sop_history (content, updated_by) SELECT content, updated_by FROM sop WHERE id = 1;
