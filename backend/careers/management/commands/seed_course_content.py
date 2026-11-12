"""Fills the demo catalogue's self-paced courses with real lessons, quizzes and an assignment:
`python manage.py seed_course_content` (run seed_training_programs first).

Safe to run repeatedly: a course that already has modules is left alone, unless --replace is given (which deletes
its modules, lessons and quizzes first — learners' progress on them goes too, so only use it on demo data).
Lessons are readings, quizzes and a PDF assignment; there are no video lessons, as those need real hosted videos."""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from careers.models import CourseModule, Lesson, LessonKind, QuizChoice, QuizQuestion, TrainingProgram


def reading(title, text):
    return {"title": title, "kind": LessonKind.TEXT, "content_text": text.strip()}


def quiz(title, questions, pass_mark=70):
    """questions: (question, explanation, [(choice, is_correct), ...])"""
    return {"title": title, "kind": LessonKind.QUIZ, "pass_mark_percent": pass_mark, "questions": questions}


def assignment(title, instructions):
    return {"title": title, "kind": LessonKind.ASSIGNMENT, "content_text": instructions.strip()}


COURSES = {
    "Property Management Basics": {
        "duration_hours": Decimal("6"),
        "description": (
            "A practical course for landlords, caretakers and new property managers in Cameroon. You'll learn how to "
            "choose reliable tenants, run a proper move-in and move-out, collect rent (including Mobile Money) without "
            "disputes, organise maintenance and keep the records that protect you and your tenants.\n\n"
            "Each module ends with a short quiz, and the course finishes with a practical assignment: a move-in "
            "inventory for a real or example unit."
        ),
        "modules": [
            ("Finding and onboarding good tenants", [
                reading("What a property manager actually does", """
A property manager protects the value of a building and the income it produces. In practice that means four jobs:

1. Filling units with reliable tenants, quickly.
2. Collecting rent on time and keeping clear records of every payment.
3. Keeping the property safe and in good repair.
4. Handling the relationship between owner and tenants — calmly, fairly and in writing.

Whether you manage one studio or fifty apartments, the same habits make the difference: write things down, give receipts, respond to problems quickly, and treat every tenant the same way. Most landlord–tenant disputes start with something that was only agreed verbally.

Throughout this course, think of one property you manage (or would like to manage) and apply each lesson to it.
"""),
                reading("Screening tenants fairly", """
Good screening prevents most rent problems. Use the same steps for every applicant, so your decisions are fair and easy to explain.

Ask every applicant for:
- A valid identity document (national ID card or passport). Check that the name matches the person in front of you.
- Proof of income or activity: recent payslips, a work attestation, a business registration, or bank / Mobile Money statements for the self-employed.
- A previous landlord's contact. Call them and ask two simple questions: did the tenant pay on time, and would you rent to them again?
- An emergency contact.

Compare the rent with the applicant's income. A common rule of thumb is that rent should not be more than about a third of monthly income; above that, late payments become much more likely.

Never decide on ethnicity, religion, gender or family situation. Decide on documents and references, and keep a short written note of why you accepted or declined someone.
"""),
                reading("The lease: what it must say", """
Always sign a written lease, in two copies — one for you, one for the tenant. A clear lease answers every question before it becomes a dispute. It should state:

- The full names and ID numbers of the landlord (or their manager) and the tenant.
- The exact address and description of the unit, including what is included (furniture, meters, parking).
- The monthly rent, the due date, and how it is paid (cash with receipt, bank transfer, MTN MoMo, Orange Money).
- The deposit (caution) amount and the conditions for returning it.
- Any advance rent paid, and which months it covers.
- Who pays water, electricity, waste collection and common-area charges.
- The length of the lease, how it is renewed, and the notice either side must give to end it.
- Rules on subletting, repairs, alterations and pets.

Both sides sign and date every page. Attach the move-in inventory (next module) to the lease: together they are your evidence if anything goes wrong.
"""),
                quiz("Quiz: tenants and leases", [
                    ("Which applicant should you ask for a previous landlord's reference?",
                     "Use the same screening steps for every applicant — it's fairer and protects you if a decision is questioned.",
                     [("Every applicant", True), ("Only applicants you don't know personally", False), ("Only applicants without a payslip", False)]),
                    ("Which of these belong in a written lease? (Choose all that apply.)",
                     "The lease should cover rent, due date and payment method, the deposit and its return conditions, charges and notice periods.",
                     [("The rent, due date and payment method", True), ("The deposit and when it is returned", True), ("The tenant's religion", False), ("Who pays water and electricity", True)]),
                    ("An applicant earns 150,000 XAF a month. Using the one-third rule of thumb, which rent is a reasonable maximum?",
                     "One third of 150,000 XAF is 50,000 XAF.",
                     [("50,000 XAF", True), ("90,000 XAF", False), ("120,000 XAF", False)]),
                ]),
            ]),
            ("Move-in, move-out and the deposit", [
                reading("The move-in inventory (état des lieux)", """
The move-in inventory records the condition of the unit on the day the tenant receives the keys. Without it, you cannot fairly keep any part of the deposit later.

Do it together with the tenant, room by room:
- Walls, ceilings and floors: note stains, cracks, holes.
- Doors, windows, locks and keys: count the keys you hand over.
- Plumbing: taps, toilet, shower, sink, any leaks.
- Electrical: sockets, switches, lights; write down the meter readings for electricity and water.
- Furniture and appliances, if the unit is furnished.

Take dated photos of each room and of any damage. Both of you sign every page, and each keeps a copy. If the tenant notices something later in the first week, add it in writing and sign again.
"""),
                reading("Handling the deposit honestly", """
The deposit (caution) protects the landlord against unpaid rent and damage beyond normal use. It is not extra rent.

- Record the amount in the lease and give a receipt.
- Normal wear and tear — faded paint, small marks from furniture, worn door handles after years of use — is not damage and should not be deducted.
- Real damage — broken windows, holes in walls, missing keys, unpaid bills — can be deducted, at a fair repair cost.

At move-out, repeat the inventory with the tenant and compare it with the move-in record and photos. Give the tenant a written list of any deductions with the cost of each, and return the rest promptly as your lease says. Clear, itemised deductions almost never lead to disputes; unexplained ones almost always do.
"""),
                quiz("Quiz: move-in and deposits", [
                    ("When should the move-in inventory be done?",
                     "It records the condition on the day the tenant receives the keys, with the tenant present.",
                     [("On the day the tenant receives the keys, together with the tenant", True), ("When the tenant moves out", False), ("Only if the tenant asks for it", False)]),
                    ("After five years, the paint in a bedroom has faded. Can this be deducted from the deposit?",
                     "Fading after years of use is normal wear and tear, not damage.",
                     [("No — it is normal wear and tear", True), ("Yes — the room needs repainting", False)]),
                    ("What should you give the tenant if you keep part of the deposit?",
                     "An itemised list with the cost of each deduction, compared with the move-in record.",
                     [("A written, itemised list of deductions and their cost", True), ("Nothing — the deposit belongs to the landlord", False), ("A verbal explanation", False)]),
                ]),
            ]),
            ("Rent, maintenance and records", [
                reading("Collecting rent without disputes", """
Make paying easy and make every payment traceable.

- Agree one due date for everyone (for example the 5th of each month) and send a friendly reminder a few days before.
- Prefer traceable payments: bank transfer, MTN MoMo or Orange Money. Ask tenants to include the unit number in the payment reference.
- Give a receipt for every payment, including cash: date, amount, period covered, unit, and your signature. A receipt book with carbon copies works well.
- Keep a simple rent ledger: one line per payment, per unit, per month.

When a payment is late, act early and in writing: a polite message on the first day late, a formal written reminder after a week, then a meeting to agree a dated payment plan. Stay respectful — a tenant who is struggling but communicates is usually worth keeping. Never cut water or electricity, change the locks or remove belongings to force payment: disputes must go through proper legal channels.
"""),
                reading("Maintenance: preventive and urgent", """
Repairs are cheaper when they are planned.

Preventive maintenance — on a schedule:
- Clean gutters and drains before the rainy season.
- Check roofs, ceilings and walls for leaks and damp.
- Service water pumps, tanks and generators.
- Check electrical installations and replace damaged sockets and cables.
- Treat for termites and pests.

Urgent repairs — handle within 24 hours: water leaks, electrical hazards, broken locks or doors, no water, sewage problems.

Keep a maintenance log: date reported, problem, who fixed it, cost, date completed. Tell tenants how to report a problem (a phone number or WhatsApp) and confirm when it's fixed. Use reliable, vetted technicians, and get a quote before non-urgent work.
"""),
                reading("Records that protect you", """
If there is ever a dispute, the person with the clearest records is usually right. For each unit, keep one folder (paper or digital) with:

- The signed lease and any amendments.
- Copies of the tenant's ID and screening documents.
- The move-in inventory with photos, and later the move-out inventory.
- The rent ledger and copies of receipts.
- Every written notice and reminder you sent.
- The maintenance log and repair invoices.

Keep these records for several years after the tenant leaves. Store digital copies somewhere safe, and protect tenants' personal information: share it only with people who need it.
"""),
                quiz("Quiz: rent, maintenance and records", [
                    ("A tenant is two weeks late with rent. What should you do first?",
                     "Communicate in writing and agree a dated payment plan. Cutting utilities or changing locks is never acceptable.",
                     [("Send a written reminder and meet to agree a dated payment plan", True), ("Cut off the electricity until they pay", False), ("Change the locks", False)]),
                    ("Which of these is an urgent repair to handle within 24 hours?",
                     "A water leak can quickly damage the building and is a safety issue.",
                     [("A water leak", True), ("Repainting a hallway", False), ("Replacing old curtains", False)]),
                    ("Which payment methods make rent easiest to trace? (Choose all that apply.)",
                     "Bank transfers and Mobile Money leave a record; cash needs a receipt every time.",
                     [("Bank transfer", True), ("MTN MoMo or Orange Money", True), ("Cash without a receipt", False)]),
                ]),
                assignment("Assignment: your move-in inventory", """
Prepare a complete move-in inventory for a real unit you manage, or for an example one-bedroom apartment.

Include, as one PDF:
1. The unit's address (or a description, for an example unit) and the date.
2. A room-by-room checklist covering walls, floors, doors and windows, plumbing, electrical points and any furniture, with the condition of each.
3. The meter readings and the number of keys handed over.
4. At least four photos (or descriptions of what you would photograph) of the unit's condition.
5. Signature lines for the landlord or manager and the tenant.

Upload it as a PDF (up to 20 MB). Your trainer will review it and may ask for changes.
"""),
            ]),
        ],
    },
    "Tenant Law in Cameroon": {
        "duration_hours": Decimal("4"),
        "description": (
            "Understand the rules that shape renting in Cameroon: leases, deposits, rent increases, repairs, notice "
            "periods and what to do when a landlord and tenant disagree. Written for tenants, landlords and agents.\n\n"
            "This course gives practical, general guidance — not legal advice. Laws and local practice change, so "
            "check your specific situation with a lawyer, a notary or a bailiff (huissier de justice)."
        ),
        "modules": [
            ("The legal framework", [
                reading("Where renting rules come from", """
Renting in Cameroon is shaped by several sources at once:

- The lease itself. What the landlord and tenant agree in writing is the first place to look, as long as it doesn't break the law.
- General contract and property law. Cameroon is bijural: the civil law tradition applies in the French-speaking regions, and the common law tradition in the North-West and South-West regions. The principles are similar — agreements must be respected, in good faith — but procedures and terminology can differ.
- Commercial leases (shops, offices, warehouses) are governed by the OHADA Uniform Act on General Commercial Law, which applies across the OHADA member states, including Cameroon. It gives business tenants specific protections, especially around renewal.
- Local practice and regulations, for example on urban planning and building safety.

Practical lesson: a clear written lease, signed by both sides, is your best protection. When something is not covered by the lease, ask a professional before acting.
"""),
                reading("Rights and duties of each side", """
In almost every lease, the same core duties apply.

The landlord must:
- Hand over the property in a good, habitable state, with the agreed equipment.
- Let the tenant enjoy the property peacefully — no unannounced visits or interference.
- Carry out major repairs (structure, roof, main plumbing and electrical installations).
- Give receipts for rent and respect the agreed rent and conditions.

The tenant must:
- Pay the rent and agreed charges on time.
- Use the property carefully and for the agreed purpose (for example, not turn a home into a bar).
- Carry out small, routine maintenance and repair damage they cause.
- Not sublet or make major alterations without written permission.
- Return the property at the end in the condition received, apart from normal wear and tear.
"""),
                quiz("Quiz: the legal framework", [
                    ("Which text governs commercial leases (shops, offices) in Cameroon?",
                     "Commercial leases fall under the OHADA Uniform Act on General Commercial Law.",
                     [("The OHADA Uniform Act on General Commercial Law", True), ("Only verbal agreements between the parties", False), ("There are no rules for commercial leases", False)]),
                    ("Who is usually responsible for repairing a leaking roof?",
                     "Major repairs to the structure and roof are the landlord's responsibility.",
                     [("The landlord", True), ("The tenant", False)]),
                    ("Which of these are tenant duties? (Choose all that apply.)",
                     "Tenants pay on time, use the property carefully and need permission to sublet.",
                     [("Pay rent on time", True), ("Ask written permission before subletting", True), ("Repair the roof structure", False), ("Use the property for the agreed purpose", True)]),
                ]),
            ]),
            ("Money: rent, advances and deposits", [
                reading("Rent, advance payments and receipts", """
Rent is the amount agreed in the lease, paid at the agreed time and in the agreed way.

- Advance rent: in many Cameroonian cities, landlords ask for several months of rent in advance at signing. Whatever is agreed, write it in the lease: the amount, and exactly which months it covers.
- Receipts: a tenant is entitled to a receipt for every payment. Keep yours — they are your proof of payment. Mobile Money and bank transfers leave a record too; keep the confirmation messages.
- Rent increases: rent can only change as the lease allows (for example at renewal), with proper notice. A landlord cannot simply announce a higher rent in the middle of a lease.

Tip for tenants: before paying anything, check the person you pay is the owner or an authorised agent — ask to see the title deed or a written mandate. Rental scams often target people paying advances.
"""),
                reading("The deposit (caution)", """
The deposit guarantees that the tenant will meet their obligations. It should be:

- Written in the lease, with the amount and the conditions for its return.
- Receipted at payment.
- Returned at the end of the lease, minus only justified deductions: unpaid rent or charges, and repairs for damage beyond normal wear and tear.

The move-in and move-out inventories (état des lieux) are the evidence for any deduction. Without a move-in inventory, it is very hard for a landlord to prove that damage happened during the tenancy.

If a deposit is not returned and discussion fails, the tenant can send a formal written demand (a mise en demeure), then use mediation or go to court.
"""),
                quiz("Quiz: rent and deposits", [
                    ("A landlord wants to raise the rent in the middle of a fixed-term lease, without the lease allowing it. Can they?",
                     "Rent can only change as the lease allows, with proper notice — typically at renewal.",
                     [("No — only as the lease allows, with proper notice", True), ("Yes, whenever they want", False)]),
                    ("What is the best evidence when deciding deductions from a deposit?",
                     "Comparing the signed move-in and move-out inventories shows what changed during the tenancy.",
                     [("The signed move-in and move-out inventories", True), ("The landlord's memory", False), ("The tenant's word", False)]),
                    ("Before paying an advance, what should a tenant check?",
                     "Rental scams often target advance payments; check ownership or a written mandate.",
                     [("That the person is the owner or an authorised agent", True), ("Nothing, if the price is good", False)]),
                ]),
            ]),
            ("Ending a lease and solving disputes", [
                reading("Notice, renewal and eviction", """
A lease ends in one of a few ways: at the end of its term, by notice given by either side as the lease and the law allow, by mutual written agreement, or by a court decision.

- Notice must be given in writing, respecting the notice period in the lease. Keep proof that it was received (a signed copy, or service by a bailiff).
- Commercial tenants have special renewal rights under the OHADA Uniform Act; a landlord who refuses renewal without a legitimate reason may owe compensation.
- Eviction must go through the courts. A landlord may not evict a tenant by force: cutting water or electricity, changing the locks or removing the tenant's belongings without a court decision are unlawful, even if rent is unpaid.
"""),
                reading("Resolving disputes step by step", """
Most disputes can be solved without a court if you follow a clear path:

1. Talk, then put it in writing. Describe the problem, what you want, and a reasonable deadline.
2. Formal demand. If nothing changes, send a formal written demand (mise en demeure), ideally served by a bailiff (huissier de justice), so there is proof.
3. Mediation. Ask a neutral person — a respected community figure, an agent, or a professional mediator — to help both sides agree. Write down and sign any agreement.
4. Court. If mediation fails, the dispute can go to the competent court. A lawyer can advise on the right procedure and the documents you'll need.

At every step, your evidence decides the outcome: the lease, receipts, inventories, photos and copies of messages.
"""),
                quiz("Final quiz: ending a lease and disputes", [
                    ("A tenant has not paid rent for three months. What may the landlord NOT do?",
                     "Self-help eviction is unlawful; eviction must go through the courts.",
                     [("Change the locks and remove the tenant's belongings", True), ("Send a formal written demand", False), ("Propose mediation", False)]),
                    ("How should notice to end a lease be given?",
                     "Notice must be in writing, respecting the agreed period, with proof of receipt.",
                     [("In writing, respecting the notice period, with proof of receipt", True), ("Verbally, at any time", False)]),
                    ("Which steps usually come before going to court? (Choose all that apply.)",
                     "Talking in writing, a formal demand and mediation usually come before court.",
                     [("Discussing the problem in writing", True), ("A formal demand (mise en demeure)", True), ("Mediation", True), ("Cutting the tenant's water", False)]),
                    ("Who can formally serve a demand so there is proof it was delivered?",
                     "A bailiff (huissier de justice) serves documents officially.",
                     [("A bailiff (huissier de justice)", True), ("Any neighbour", False)]),
                ]),
            ]),
        ],
    },
    "Hospitality Operations 101": {
        "duration_hours": Decimal("5"),
        "description": (
            "The essentials of running a guest house or small hotel: welcoming guests at the front desk, managing "
            "bookings and payments, housekeeping standards, and handling complaints so guests leave happy and come "
            "back. Practical checklists you can use from day one."
        ),
        "modules": [
            ("The front desk", [
                reading("Welcoming guests: check-in", """
The first two minutes shape the whole stay. A good check-in is warm, quick and accurate.

1. Greet the guest by name if you know it, with a smile, and offer water if they have travelled.
2. Confirm the booking: name, dates, room type, number of guests, and the price.
3. Check identity: record the guest's ID or passport details as required, and handle the document respectfully.
4. Take payment or confirm it: say exactly what has been paid, what is due, and how (cash, Mobile Money, card).
5. Explain the essentials: Wi-Fi, breakfast times, checkout time, how to reach the desk at night.
6. Hand over the key and show the way to the room, or accompany the guest.

Have everything ready before the guest arrives: the room inspected, the registration form prepared, the key labelled.
"""),
                reading("Bookings, overbooking and payments", """
Keep one source of truth for availability — a booking system or a single, well-kept booking register — and update it immediately after every booking, change or cancellation, from every channel (phone, walk-in, WhatsApp, online platforms). Most double bookings happen when two channels aren't synchronised.

- Confirm every booking in writing with the dates, price and cancellation conditions.
- Take a deposit for long or high-season stays, and give a receipt.
- Reconcile payments every day: the cash in the till and Mobile Money received must match the register.

If you are ever overbooked, tell the guest immediately and honestly, find them an equivalent room nearby at your cost, and arrange transport. Handled well, even this can keep a guest's trust.
"""),
                quiz("Quiz: front desk", [
                    ("What is the most common cause of double bookings?",
                     "Availability must be updated in one place after every booking from every channel.",
                     [("Booking channels that aren't kept in sync", True), ("Guests arriving early", False), ("Taking deposits", False)]),
                    ("During check-in, which steps are essential? (Choose all that apply.)",
                     "Confirm the booking, check identity, confirm payment and explain the essentials.",
                     [("Confirm the booking details and price", True), ("Check and record the guest's identity", True), ("Explain checkout time and Wi-Fi", True), ("Ask about the guest's salary", False)]),
                    ("You're overbooked and a guest with a confirmed booking arrives. What should you do?",
                     "Be honest, relocate the guest to an equivalent room at your cost and arrange transport.",
                     [("Tell them honestly and arrange an equivalent room nearby at your cost", True), ("Tell them to come back tomorrow", False), ("Give them a lower-category room without saying anything", False)]),
                ]),
            ]),
            ("Housekeeping standards", [
                reading("Preparing a room: the checklist", """
A guest notices what is wrong long before they notice what is right. Use the same checklist for every room:

- Bed: fresh sheets and pillowcases for every new guest, made tightly; no hair or stains.
- Bathroom: toilet, sink and shower cleaned and disinfected; fresh towels; soap and toilet paper; no hair in drains; no smell.
- Floor: swept and mopped, including under the bed.
- Surfaces: dusted — tables, headboard, light switches, door handles, remote control.
- Equipment: test the lights, fan or air conditioning, TV, sockets, hot water and the door lock.
- Supplies: bin emptied with a new bag, drinking water, mosquito net in good condition where needed.

A supervisor inspects the room before it is marked "ready". Rooms are cleaned from top to bottom and from the cleanest areas to the dirtiest.
"""),
                reading("Hygiene, safety and lost property", """
- Use separate cloths for the toilet and for other surfaces (colour-coded), and wash them daily.
- Wear gloves when cleaning bathrooms and handling dirty linen; wash hands afterwards.
- Store cleaning chemicals away from guests and never mix bleach with other products.
- Report anything unsafe immediately: exposed wires, broken glass, leaks, faulty locks.
- Respect guests' privacy and belongings: knock and announce yourself, never go through their things, and never enter a room showing "Do not disturb" except in an emergency.

Lost property: record every item found (date, room, description, who found it), store it safely, and contact the guest. Keep unclaimed items for a fixed period.
"""),
                quiz("Quiz: housekeeping", [
                    ("Why use colour-coded cloths?",
                     "So cloths used on toilets are never used on sinks, cups or other surfaces.",
                     [("To avoid spreading germs from toilets to other surfaces", True), ("Because guests like colours", False)]),
                    ("Who should check a room before it is marked ready?",
                     "A supervisor's inspection catches what the cleaner might miss.",
                     [("A supervisor", True), ("Nobody — the guest will report problems", False)]),
                    ("You find a watch in a room after checkout. What do you do?",
                     "Record it in the lost-property log, store it safely and contact the guest.",
                     [("Record it, store it safely and contact the guest", True), ("Keep it", False), ("Leave it in the room", False)]),
                ]),
            ]),
            ("Guest experience and complaints", [
                reading("Handling complaints: the LAST method", """
A complaint handled well often creates a more loyal guest than no problem at all. Use LAST:

- Listen: let the guest finish without interrupting. Take notes.
- Apologise: sincerely, for the inconvenience — even before you know whose fault it was.
- Solve: offer a concrete solution and a time: "I'll move you to room 12 within 15 minutes", "The technician will fix the shower before 6 pm".
- Thank: thank the guest for telling you, and follow up later to check the solution worked.

Stay calm, never argue in front of other guests, and know what you're allowed to offer (a room change, a free breakfast, a discount) so you can act immediately. Record every complaint and how it was solved, and review them each week to fix the root causes.
"""),
                reading("Reviews and repeat guests", """
Most travellers read reviews before booking. You can influence them:

- Ask satisfied guests at checkout to leave a review, and make it easy (a link or QR code).
- Reply to every review, positive or negative, politely and within a few days. For a negative review: thank the guest, apologise for the experience, explain what you've changed, and invite them back. Never argue publicly.
- Remember returning guests: their name, preferred room, how they take their coffee. Small personal touches turn a guest into a regular.
"""),
                quiz("Final quiz: guest experience", [
                    ("What does LAST stand for?",
                     "Listen, Apologise, Solve, Thank.",
                     [("Listen, Apologise, Solve, Thank", True), ("Look, Ask, Sell, Tell", False), ("Listen, Argue, Settle, Thank", False)]),
                    ("A guest complains loudly in the lobby that their room is noisy. What should you do first?",
                     "Listen without interrupting, then apologise and offer a concrete solution — ideally away from other guests.",
                     [("Listen calmly, apologise, and offer a concrete solution", True), ("Explain that every room is noisy", False), ("Ask them to write an email", False)]),
                    ("How should you respond to a negative online review? (Choose all that apply.)",
                     "Thank, apologise, explain what changed and invite them back — never argue publicly.",
                     [("Thank the guest and apologise", True), ("Explain what you have changed", True), ("Argue that the guest is wrong", False)]),
                ]),
            ]),
        ],
    },
}


class Command(BaseCommand):
    help = "Add lessons, quizzes and an assignment to the demo self-paced courses (safe to run repeatedly)."

    def add_arguments(self, parser):
        parser.add_argument("--replace", action="store_true", help="Delete and recreate the content of these courses.")

    def handle(self, *args, **options):
        for title, spec in COURSES.items():
            program = TrainingProgram.objects.filter(title=title).first()
            if program is None:
                self.stdout.write(self.style.WARNING(f"Skipped '{title}': run seed_training_programs first."))
                continue
            if program.modules.exists() and not options["replace"]:
                self.stdout.write(f"Skipped '{title}': it already has content (use --replace to recreate it).")
                continue
            with transaction.atomic():
                program.modules.all().delete()
                lessons = self._build(program, spec)
            self.stdout.write(self.style.SUCCESS(f"'{title}': {len(spec['modules'])} modules, {lessons} lessons."))

    def _build(self, program, spec) -> int:
        program.description = spec["description"]
        program.duration_hours = spec["duration_hours"]
        program.save(update_fields=["description", "duration_hours"])
        count = 0
        for module_position, (module_title, lessons) in enumerate(spec["modules"]):
            module = CourseModule.objects.create(program=program, title=module_title, position=module_position)
            for position, item in enumerate(lessons):
                lesson = Lesson.objects.create(
                    module=module, title=item["title"], kind=item["kind"], position=position,
                    content_text=item.get("content_text", ""), pass_mark_percent=item.get("pass_mark_percent", 70),
                )
                for q_position, (text, explanation, choices) in enumerate(item.get("questions", [])):
                    question = QuizQuestion.objects.create(lesson=lesson, text=text, explanation=explanation, position=q_position)
                    QuizChoice.objects.bulk_create(
                        QuizChoice(question=question, text=choice, is_correct=correct, position=c_position)
                        for c_position, (choice, correct) in enumerate(choices)
                    )
                count += 1
        return count
