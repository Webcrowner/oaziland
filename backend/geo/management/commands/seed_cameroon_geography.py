"""Seeds Cameroon's regions, main cities and well-known neighbourhoods so
the search/listing dropdowns cover the whole country, not just demo data.
Idempotent (get_or_create everywhere) — safe to re-run, and safe to extend
by adding entries to CAMEROON_GEOGRAPHY below.

Each city is stored as Subdivision + VillageOrDistrict named after the
city, with its neighbourhoods as Quarters, so a dropdown reads
"Bastos (Yaoundé)"."""
from django.core.management.base import BaseCommand
from django.db import transaction

from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter

# region -> [(division, city, [neighbourhoods])]
CAMEROON_GEOGRAPHY = {
    "Centre": [
        ("Mfoundi", "Yaoundé", [
            "Bastos", "Nlongkak", "Etoudi", "Mfandena", "Tsinga", "Mokolo", "Briqueterie", "Messa",
            "Mvan", "Essos", "Biyem-Assi", "Melen", "Ngoa-Ekellé", "Obili", "Odza", "Nsimeyong",
            "Efoulan", "Mendong", "Simbock", "Emana", "Nkolbisson", "Mimboman", "Ekounou", "Kondengui",
            "Mvog-Ada", "Nsam", "Mvog-Mbi", "Santa Barbara", "Ahala", "Nkomo", "Elig-Essono",
            "Olezoa", "Damas", "Ngousso", "Mvolyé", "Awae",
        ]),
        ("Nyong-et-So'o", "Mbalmayo", ["Centre-Ville"]),
        ("Lekié", "Obala", ["Centre-Ville"]),
        ("Mbam-et-Inoubou", "Bafia", ["Centre-Ville"]),
        ("Haute-Sanaga", "Nanga-Eboko", ["Centre-Ville"]),
    ],
    "Littoral": [
        ("Wouri", "Douala", [
            "Akwa", "Bonanjo", "Bonapriso", "Bonamoussadi", "Makepe", "Logpom", "Logbessou", "Deido",
            "Bali", "New Bell", "Bépanda", "Ndokotti", "Kotto", "Cité des Palmiers", "Bonabéri",
            "PK8", "PK10", "PK12", "PK14", "Japoma", "Yassa", "Nyalla", "Logbaba", "Cité SIC",
            "Bassa", "Ndogbong", "Bonadibong", "Bonaloka", "Akwa Nord", "Village", "Ngodi Bakoko",
            "Bonendale", "Ange Raphaël",
        ]),
        ("Moungo", "Nkongsamba", ["Centre-Ville"]),
        ("Moungo", "Loum", ["Centre-Ville"]),
        ("Moungo", "Mbanga", ["Centre-Ville"]),
        ("Moungo", "Penja", ["Centre-Ville"]),
        ("Sanaga-Maritime", "Edéa", ["Centre-Ville"]),
    ],
    "South West": [
        ("Fako", "Buea", [
            "Molyko", "Great Soppo", "Small Soppo", "Bokwango", "Bonduma", "Muea", "Clerks Quarters",
            "Sandpit", "Bomaka", "Buea Town", "Mile 16", "Bokova", "Tole",
        ]),
        ("Fako", "Limbe", [
            "Down Beach", "Mile 4", "Bonadikombo", "Church Street", "Batoke", "Mbonjo", "Limbe Central",
            "Bota", "Newtown", "Mokunda",
        ]),
        ("Fako", "Tiko", ["Centre-Ville"]),
        ("Fako", "Muyuka", ["Centre-Ville"]),
        ("Meme", "Kumba", ["Kumba Town", "Fiango", "Mbonge Road", "Buea Road", "Kosala"]),
        ("Manyu", "Mamfe", ["Centre-Ville"]),
    ],
    "North West": [
        ("Mezam", "Bamenda", [
            "Up Station", "Commercial Avenue", "Nkwen", "Mankon", "Bambili", "Bamendankwe", "Ntarikon",
            "Old Town", "Ntamulung", "Nacho", "Bambui", "Sisia", "Mulang", "Foncha Street", "Mile 3 Nkwen",
        ]),
        ("Bui", "Kumbo", ["Centre-Ville"]),
        ("Menchum", "Wum", ["Centre-Ville"]),
        ("Donga-Mantung", "Nkambe", ["Centre-Ville"]),
        ("Ngoketunjia", "Ndop", ["Centre-Ville"]),
    ],
    "West": [
        ("Mifi", "Bafoussam", [
            "Tamdja", "Djeleng", "Banengo", "Famla", "Kamkop", "Tougang", "Ndiangdam", "Houkaha", "Lafé",
        ]),
        ("Menoua", "Dschang", ["Foto", "Foreke", "Centre-Ville", "Tsinkop"]),
        ("Bamboutos", "Mbouda", ["Centre-Ville"]),
        ("Noun", "Foumban", ["Centre-Ville"]),
        ("Noun", "Foumbot", ["Centre-Ville"]),
        ("Haut-Nkam", "Bafang", ["Centre-Ville"]),
        ("Ndé", "Bangangté", ["Centre-Ville"]),
    ],
    "Adamawa": [
        ("Vina", "Ngaoundéré", ["Dang", "Baladji", "Burkina", "Joli Soir", "Marza", "Centre-Ville"]),
        ("Mbéré", "Meiganga", ["Centre-Ville"]),
        ("Djérem", "Tibati", ["Centre-Ville"]),
    ],
    "North": [
        ("Bénoué", "Garoua", ["Roumdé Adjia", "Poumpoumré", "Lopéré", "Foulbéré", "Marouaré", "Plateau"]),
        ("Mayo-Louti", "Guider", ["Centre-Ville"]),
        ("Faro", "Poli", ["Centre-Ville"]),
    ],
    "Far North": [
        ("Diamaré", "Maroua", [
            "Domayo", "Doualaré", "Kakataré", "Pont Vert", "Founangué", "Djarengol", "Palar", "Hardé",
        ]),
        ("Mayo-Tsanaga", "Mokolo", ["Centre-Ville"]),
        ("Logone-et-Chari", "Kousséri", ["Centre-Ville"]),
        ("Mayo-Danay", "Yagoua", ["Centre-Ville"]),
    ],
    "East": [
        ("Lom-et-Djérem", "Bertoua", ["Mokolo", "Tigaza", "Nkolbikon", "Kpokolota", "Haoussa"]),
        ("Kadey", "Batouri", ["Centre-Ville"]),
        ("Haut-Nyong", "Abong-Mbang", ["Centre-Ville"]),
        ("Boumba-et-Ngoko", "Yokadouma", ["Centre-Ville"]),
    ],
    "South": [
        ("Océan", "Kribi", [
            "Ngoyè", "Mpangou", "Mboa-Manga", "Elabe", "Afan Mabe", "Londji", "Grand Batanga", "Lolabe",
            "Kribi Centre",
        ]),
        ("Mvila", "Ebolowa", ["Angalé", "Nko'ovos", "Centre-Ville"]),
        ("Dja-et-Lobo", "Sangmélima", ["Centre-Ville"]),
        ("Vallée-du-Ntem", "Ambam", ["Centre-Ville"]),
    ],
}


class Command(BaseCommand):
    help = "Seed Cameroon regions, main cities and neighbourhoods (idempotent)."

    @transaction.atomic
    def handle(self, *args, **options):
        country, _ = Country.objects.get_or_create(name="Cameroon", defaults={"iso_code": "CMR"})
        created = 0
        for region_name, cities in CAMEROON_GEOGRAPHY.items():
            region, _ = Region.objects.get_or_create(country=country, name=region_name)
            for division_name, city, quarters in cities:
                division, _ = Division.objects.get_or_create(region=region, name=division_name)
                subdivision, _ = Subdivision.objects.get_or_create(division=division, name=city)
                district, _ = VillageOrDistrict.objects.get_or_create(subdivision=subdivision, name=city)
                for quarter_name in quarters:
                    _, was_created = Quarter.objects.get_or_create(village_or_district=district, name=quarter_name)
                    created += was_created
        self.stdout.write(self.style.SUCCESS(f"Seeded {created} new quarters ({Quarter.objects.count()} total)."))
