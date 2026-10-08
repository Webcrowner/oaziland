from django.db import migrations

FAQS = [
    (
        "How does the 7-Minute Reservation Hold Lock work?",
        "When you tap 'Reserve' on any listing, hotel, or student hostel, Oaziland places a strict, Redis-backed 7-minute exclusive lock on that property. During those 7 minutes, no other user or agent can book it or double-contract behind your back while you complete your Mobile Money checkout.",
        "Comment fonctionne le verrou de r\u00e9servation de 7 minutes ?",
        "Lorsque vous appuyez sur \u00ab R\u00e9server \u00bb sur une annonce, un h\u00f4tel ou une r\u00e9sidence \u00e9tudiante, Oaziland place un verrou exclusif de 7 minutes sur ce bien. Pendant ces 7 minutes, aucun autre utilisateur ni agent ne peut le r\u00e9server ni contracter dans votre dos pendant que vous finalisez votre paiement Mobile Money.",
    ),
    (
        "How does Mobile Money Escrow protect my payment?",
        "Your funds are held securely in Oaziland's centralized PaymentEscrow engine (via MTN MoMo or Orange Money) and are NEVER released directly to the landlord or driver upfront. The funds are only disbursed once you inspect the keys, check into your room, or receive your service. If there is a dispute, admins can immediately freeze or refund the payment.",
        "Comment le s\u00e9questre Mobile Money prot\u00e8ge-t-il mon paiement ?",
        "Vos fonds sont conserv\u00e9s en s\u00e9curit\u00e9 dans le syst\u00e8me de s\u00e9questre d'Oaziland (via MTN MoMo ou Orange Money) et ne sont JAMAIS vers\u00e9s directement au propri\u00e9taire ou au chauffeur \u00e0 l'avance. Les fonds ne sont d\u00e9bloqu\u00e9s qu'apr\u00e8s la remise des cl\u00e9s, votre installation ou la r\u00e9ception de votre service. En cas de litige, les administrateurs peuvent geler ou rembourser imm\u00e9diatement le paiement.",
    ),
    (
        "Are property deeds and boundary coordinates really verified?",
        "Yes. To combat Cameroon's prevalent land scams and double-selling, our verification team audits land titles against boundary coordinates and official records before awarding the green 'Verified Title' badge. Unverified listings are clearly marked as pending review.",
        "Les titres fonciers et les coordonn\u00e9es de bornage sont-ils r\u00e9ellement v\u00e9rifi\u00e9s ?",
        "Oui. Pour lutter contre les arnaques fonci\u00e8res et la double vente, notre \u00e9quipe de v\u00e9rification contr\u00f4le les titres fonciers par rapport aux coordonn\u00e9es de bornage et aux registres officiels avant d'attribuer le badge vert \u00ab Titre v\u00e9rifi\u00e9 \u00bb. Les annonces non v\u00e9rifi\u00e9es sont clairement indiqu\u00e9es comme en attente de v\u00e9rification.",
    ),
    (
        "Can university students pay hostel rents in installments?",
        "Yes! Partnered campus hostels in Molyko (Buea), Ngoa-Ekell\u00e9 / Melen (Yaound\u00e9), and Douala support semester and trimester installment schedules through Mobile Money, making accommodation manageable for student budgets.",
        "Les \u00e9tudiants peuvent-ils payer leur loyer de r\u00e9sidence par tranches ?",
        "Oui ! Les r\u00e9sidences partenaires de Molyko (Buea), Ngoa-Ekell\u00e9 / Melen (Yaound\u00e9) et Douala proposent des paiements \u00e9chelonn\u00e9s par semestre et par trimestre via Mobile Money, pour s'adapter aux budgets \u00e9tudiants.",
    ),
    (
        "What happens if a property does not match what was shown online?",
        "Because your deposit is held in escrow, you can immediately open a formal Dispute from your 'My Bookings' page. Our administrative team investigates within 48 hours and releases a full refund if the lister misrepresented the property.",
        "Que se passe-t-il si le bien ne correspond pas \u00e0 ce qui \u00e9tait montr\u00e9 en ligne ?",
        "Votre acompte \u00e9tant plac\u00e9 sous s\u00e9questre, vous pouvez ouvrir imm\u00e9diatement un litige depuis la page \u00ab Mes r\u00e9servations \u00bb. Notre \u00e9quipe enqu\u00eate sous 48 heures et rembourse int\u00e9gralement si l'annonceur a pr\u00e9sent\u00e9 le bien de mani\u00e8re trompeuse.",
    ),
]


def seed_faqs(apps, schema_editor):
    Faq = apps.get_model("engagement", "Faq")
    if Faq.objects.exists():
        return
    for position, (question_en, answer_en, question_fr, answer_fr) in enumerate(FAQS):
        Faq.objects.create(
            question_en=question_en, answer_en=answer_en, question_fr=question_fr, answer_fr=answer_fr,
            display_order=position,
        )


class Migration(migrations.Migration):
    dependencies = [("engagement", "0005_faq")]
    operations = [migrations.RunPython(seed_faqs, migrations.RunPython.noop)]
