"""
Seeds realistic demo marketplace listings across Cameroon: everyday goods (phones, laptops, furniture,
appliances, fashion, farm produce, building materials, car parts), cars for sale and for rent (with full
vehicle specs and rental terms), shops, warehouses and businesses for sale, from several sellers, some
boosted to TOP. Every description says it is demo data and everything belongs to demo_mkt_* users.

    manage.py seed_demo_marketplace            # create (skips if already there)
    manage.py seed_demo_marketplace --reset    # remove the demo listings and their sellers, then create them again
    manage.py seed_demo_marketplace --remove   # remove them only
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

PREFIX = "demo_mkt_"
DEMO_NOTE = "Demo listing: sample data showing how Oaziland works, not a real offer."
IMG = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=1200&q=80"
P = {
    "phone1": "1511707171634-5f897ff02aa9", "phone2": "1592750475338-74b7b21085ab", "phone3": "1610945265064-0e34e5519bbf",
    "laptop1": "1496181133206-80ce9b88a853", "laptop2": "1517336714731-489689fd1ca8", "tv": "1593359677879-a4bb92f829d1",
    "sneakers": "1542291026-7eec264c27ff", "dress": "1515372039744-b8f02a3ae446", "sofa": "1555041469-a586c61ea9bc",
    "fridge": "1571175443880-49e1d25b2bc5", "car1": "1549399542-7e3f8b79c341", "car2": "1503376780353-7e6692767b70",
    "car3": "1533473359331-0135ef1b58bf", "car4": "1552519507-da3b142c6e3d", "car5": "1494976388531-d1058494cdd8",
    "suv": "1519641471654-76ce0107ad1b", "store1": "1441986300917-64674bd600d8", "store2": "1604719312566-8912e9227c6a",
    "wh1": "1586528116311-ad8dd3c8310d", "wh2": "1553413077-190dd305871c", "resto": "1517248135467-4c7edcad34c4",
    "build": "1504307651254-35680f356dfd", "tyres": "1486262715619-67b85e0b08d3", "rice": "1586201375761-83865001e31c",
    "bag": "1548036328-c9fa89d128fa", "watch": "1523275335684-37898b6baf30", "headphones": "1505740420928-5e560c06d30e",
    "table": "1533090481720-856c6e3c1fdc", "salon": "1560066984-138dadb4c035", "pharmacy": "1587854692152-cbe660dbde88",
    "van": "1544636331-e26879cd4d9b", "cement": "1590069261209-f8e9b8642343",
}

SELLERS = {
    # key: (username suffix, phone, first name, last name, is agent)
    "akwa_tech": ("akwa_tech", "+237670200001", "Serge", "Mbappe", False),
    "yaounde_home": ("yaounde_home", "+237670200002", "Clarisse", "Owona", False),
    "auto_douala": ("auto_douala", "+237670200003", "Thierry", "Ngando", False),
    "buea_style": ("buea_style", "+237670200004", "Grace", "Ebai", False),
    "estate_agent": ("estate_agent", "+237670200005", "Hervé", "Kamga", True),
}

# Goods: (seller, title, category, condition, price, quantity, (quarter, town), attributes, delivery, photos, description, boosted)
GOODS = [
    ("akwa_tech", "iPhone 13 128GB, blue", "PHONES", "LIKE_NEW", 285000, 1, ("Akwa", "Douala"),
     {"brand": "Apple", "model": "iPhone 13", "storage_gb": 128, "ram_gb": 4, "color": "Blue", "battery_health_pct": 89},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 2000, "seller_delivery_areas": "Akwa, Bonanjo, Bonapriso, Deido",
      "courier_shipping": True, "courier_fee_xaf": 3500, "courier_note": "Sent with a bus agency to Yaoundé, Buea and Bafoussam."},
     ["phone2", "phone1"], "Clean iPhone 13, never repaired, Face ID working, sold with charger and case. Unlocked for MTN and Orange.", True),
    ("akwa_tech", "Samsung Galaxy A54 5G 256GB", "PHONES", "NEW", 215000, 4, ("Akwa", "Douala"),
     {"brand": "Samsung", "model": "Galaxy A54 5G", "storage_gb": 256, "ram_gb": 8, "color": "Graphite"},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 2000, "seller_delivery_areas": "Douala centre", "courier_shipping": True, "courier_fee_xaf": 3500},
     ["phone3"], "Brand new in sealed box, dual SIM, one-year shop warranty.", False),
    ("akwa_tech", "HP EliteBook 840 G6, Core i5, 16GB RAM", "ELECTRONICS", "USED", 245000, 2, ("Akwa", "Douala"),
     {"brand": "HP", "model": "EliteBook 840 G6", "warranty_months": 3},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 2000, "seller_delivery_areas": "Douala", "courier_shipping": True, "courier_fee_xaf": 4000},
     ["laptop1", "laptop2"], "Business laptop in very good condition: 512GB SSD, backlit keyboard, battery holds about 5 hours.", False),
    ("akwa_tech", "Smart TV 55\" 4K", "ELECTRONICS", "NEW", 265000, 3, ("Akwa", "Douala"),
     {"brand": "Hisense", "model": "55A6K", "warranty_months": 12},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 5000, "seller_delivery_areas": "Douala"},
     ["tv"], "55-inch 4K smart TV with Netflix and YouTube, wall bracket included.", True),
    ("akwa_tech", "Wireless headphones, noise cancelling", "ELECTRONICS", "LIKE_NEW", 38000, 1, ("Bonamoussadi", "Douala"),
     {"brand": "Sony", "model": "WH-CH720N"}, {}, ["headphones"], "Used twice, in the box with cable.", False),
    ("yaounde_home", "3-seater fabric sofa", "HOME", "NEW", 185000, 2, ("Bastos", "Yaoundé"),
     {"material": "Fabric and hardwood", "color": "Grey", "dimensions": "210 x 90 x 85 cm"},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 7500, "seller_delivery_areas": "Yaoundé"},
     ["sofa"], "Made in our Yaoundé workshop with a hardwood frame. Other colours to order in 10 days.", True),
    ("yaounde_home", "Solid wood dining table, 6 seats", "HOME", "NEW", 160000, 1, ("Bastos", "Yaoundé"),
     {"material": "Iroko wood", "color": "Natural", "dimensions": "180 x 90 cm"},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 7500, "seller_delivery_areas": "Yaoundé"},
     ["table"], "Iroko dining table, varnished. Chairs sold separately.", False),
    ("yaounde_home", "Double-door refrigerator 350L", "APPLIANCES", "NEW", 320000, 2, ("Melen", "Yaoundé"),
     {"brand": "Samsung", "power_source": "ELECTRIC", "warranty_months": 24},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 5000, "seller_delivery_areas": "Yaoundé"},
     ["fridge"], "Frost-free fridge with inverter compressor, low consumption. Delivered and installed.", False),
    ("buea_style", "Ankara wrap dress", "FASHION", "NEW", 18000, 6, ("Great Soppo", "Buea"),
     {"size": "M", "color": "Blue and orange", "brand": "Ebai Designs", "gender": "WOMEN"},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 1000, "seller_delivery_areas": "Buea, Limbe", "courier_shipping": True, "courier_fee_xaf": 2500},
     ["dress"], "Hand-sewn wrap dress in Ankara print. Sizes S to XL, made to measure on request.", False),
    ("buea_style", "Leather handbag", "FASHION", "NEW", 25000, 3, ("Great Soppo", "Buea"),
     {"color": "Tan", "brand": "Ebai Designs", "gender": "WOMEN"}, {"courier_shipping": True, "courier_fee_xaf": 2500},
     ["bag"], "Genuine leather handbag with an inside zip pocket.", False),
    ("buea_style", "Running sneakers", "FASHION", "NEW", 32000, 5, ("Great Soppo", "Buea"),
     {"size": "42", "color": "Red", "brand": "Nike", "gender": "UNISEX"}, {"courier_shipping": True, "courier_fee_xaf": 2500},
     ["sneakers"], "Light running shoes, sizes 39 to 45.", False),
    ("buea_style", "Men's wrist watch", "FASHION", "LIKE_NEW", 22000, 1, ("Mile 4", "Limbe"),
     {"color": "Silver", "gender": "MEN"}, {}, ["watch"], "Stainless steel watch, new battery.", False),
    ("auto_douala", "Car tyres 205/55 R16 (set of 4)", "VEHICLE_PARTS", "NEW", 160000, 6, ("Bonabéri", "Douala"),
     {"fits_make": "Toyota", "fits_model": "Corolla, Avensis", "part_number": "205/55R16"},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 3000, "seller_delivery_areas": "Douala"},
     ["tyres"], "New tyres, fitting and balancing included at our Bonabéri garage.", False),
    ("yaounde_home", "Rice, 50 kg bag", "FOOD", "NEW", 27500, 40, ("Mvan", "Yaoundé"), {},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 1500, "seller_delivery_areas": "Yaoundé"},
     ["rice"], "Long-grain perfumed rice, 50 kg bags. Discount from 10 bags.", False),
    ("auto_douala", "Cement 42.5R, 50 kg bags", "BUILDING", "NEW", 5200, 500, ("Bonabéri", "Douala"), {},
     {"seller_delivery": True, "seller_delivery_fee_xaf": 15000, "seller_delivery_areas": "Douala (from 50 bags)"},
     ["cement", "build"], "Cement 42.5R, price per bag. Truck delivery to your site from 50 bags.", False),
]

# Cars: (seller, title, price basis, price, (quarter, town), spec dict, terms dict, photos, description, boosted)
CARS = [
    ("auto_douala", "Toyota Corolla 2016, automatic", "SALE", 7800000, ("Bonabéri", "Douala"),
     dict(make="Toyota", model="Corolla", year=2016, mileage_km=98000, engine_size_cc=1800, body_type="SEDAN", fuel_type="PETROL",
          transmission="AUTOMATIC", drivetrain="FWD", exterior_color="Silver", seats=5, doors=4, vehicle_condition="FOREIGN_USED",
          customs_cleared=True, registration_in_seller_name=True, accident_free=True, service_history=True,
          features=["AIR_CONDITIONING", "BLUETOOTH", "REVERSE_CAMERA", "POWER_WINDOWS"]),
     dict(price_negotiable=True), ["car1", "car2"], "Venant from Belgium, cleared and registered. Clean interior, cold AC, no accident.", True),
    ("auto_douala", "Toyota RAV4 2014, 4x4", "SALE", 11500000, ("Bonabéri", "Douala"),
     dict(make="Toyota", model="RAV4", year=2014, mileage_km=132000, engine_size_cc=2500, body_type="SUV", fuel_type="PETROL",
          transmission="AUTOMATIC", drivetrain="4WD", exterior_color="Black", seats=5, doors=5, vehicle_condition="LOCALLY_USED",
          customs_cleared=True, registration_in_seller_name=True, previous_owners=1, service_history=True,
          features=["AIR_CONDITIONING", "ALLOY_WHEELS", "CRUISE_CONTROL", "ROOF_RACK"]),
     dict(price_negotiable=True), ["suv", "car3"], "One owner since import, serviced at the dealer. Ready for the road to the West.", False),
    ("auto_douala", "Hyundai Elantra 2018", "SALE", 8900000, ("Kotto", "Douala"),
     dict(make="Hyundai", model="Elantra", year=2018, mileage_km=74000, engine_size_cc=2000, body_type="SEDAN", fuel_type="PETROL",
          transmission="AUTOMATIC", drivetrain="FWD", exterior_color="White", seats=5, doors=4, vehicle_condition="FOREIGN_USED",
          customs_cleared=True, registration_in_seller_name=False, accident_free=True,
          features=["AIR_CONDITIONING", "BLUETOOTH", "KEYLESS_ENTRY", "PARKING_SENSORS"]),
     dict(), ["car4"], "Recently cleared, carte grise transfer included in the price.", False),
    ("auto_douala", "Toyota Prado for rent, with driver", "RENT_NIGHTLY", 75000, ("Akwa", "Douala"),
     dict(make="Toyota", model="Land Cruiser Prado", year=2019, body_type="SUV", fuel_type="DIESEL", transmission="AUTOMATIC",
          drivetrain="4WD", exterior_color="White", seats=7, doors=5, features=["AIR_CONDITIONING", "THIRD_ROW_SEATS", "BLUETOOTH"]),
     dict(driver_option="EITHER", driver_fee_per_day_xaf=15000, weekly_discount_pct=10, monthly_discount_pct=20, min_rental_days=1,
          max_rental_days=60, daily_km_limit=300, extra_km_fee_xaf=200, fuel_policy="SAME_LEVEL", min_driver_age=25,
          min_licence_years=3, insurance_included=True, delivery_available=True, delivery_fee_xaf=10000, instant_book=True),
     ["suv"], "Comfortable 7-seater for weddings, airport pickups and trips to Kribi or Yaoundé. Comprehensive insurance included.", True),
    ("auto_douala", "Toyota Corolla for rent, self-drive", "RENT_NIGHTLY", 30000, ("Bonamoussadi", "Douala"),
     dict(make="Toyota", model="Corolla", year=2017, body_type="SEDAN", fuel_type="PETROL", transmission="AUTOMATIC",
          exterior_color="Grey", seats=5, doors=4, features=["AIR_CONDITIONING", "BLUETOOTH"]),
     dict(driver_option="SELF_DRIVE", weekly_discount_pct=10, monthly_discount_pct=25, min_rental_days=2, daily_km_limit=250,
          extra_km_fee_xaf=150, fuel_policy="FULL_TO_FULL", min_driver_age=23, min_licence_years=2, insurance_included=True,
          instant_book=False),
     ["car5"], "Economical city car. Owner confirms each booking request within a few hours.", False),
    ("auto_douala", "Toyota Hiace minibus for rent, 15 seats", "RENT_NIGHTLY", 90000, ("Mvan", "Yaoundé"),
     dict(make="Toyota", model="Hiace", year=2015, body_type="MINIBUS", fuel_type="DIESEL", transmission="MANUAL",
          exterior_color="White", seats=15, doors=4, features=["AIR_CONDITIONING"]),
     dict(driver_option="WITH_DRIVER", driver_fee_per_day_xaf=0, min_rental_days=1, fuel_policy="INCLUDED", insurance_included=True,
          instant_book=True), ["van"], "Minibus with driver for group travel, school trips and funerals. Fuel included within Yaoundé.", False),
]

# Places: (category, seller, title, price basis, price, deposit, (quarter, town), extra fields, photos, description, boosted)
PLACES = [
    ("stores", "estate_agent", "Shop with wide frontage, Akwa boulevard", "RENT_MONTHLY", 450000, 900000, ("Akwa", "Douala"),
     {"size_sqm": Decimal("65"), "frontage_meters": Decimal("7")}, ["store1", "store2"],
     "Ground-floor shop on a busy boulevard, tiled, with a storeroom and a toilet. Two months' deposit.", True),
    ("stores", "estate_agent", "Boutique near Mokolo market", "RENT_MONTHLY", 150000, 300000, ("Essos", "Yaoundé"),
     {"size_sqm": Decimal("24"), "frontage_meters": Decimal("4")}, ["store2"], "Small boutique in a high-footfall street.", False),
    ("warehouses", "estate_agent", "Warehouse 1,200 m² near the port", "RENT_MONTHLY", 2400000, 4800000, ("Bonabéri", "Douala"),
     {"size_sqm": Decimal("1200")}, ["wh1", "wh2"],
     "Secure warehouse with truck access, 8 m ceiling, offices and 24/7 guard, ten minutes from the port of Douala.", True),
    ("warehouses", "estate_agent", "Storage depot 400 m², Mvan", "RENT_MONTHLY", 700000, 1400000, ("Mvan", "Yaoundé"),
     {"size_sqm": Decimal("400")}, ["wh2"], "Depot on the Douala road exit, easy access for trucks.", False),
    ("businesses", "estate_agent", "Restaurant for sale, Bastos", "SALE", 28000000, 0, ("Bastos", "Yaoundé"),
     {"size_sqm": Decimal("180"), "seating_capacity": 60, "includes_goodwill": True, "includes_inventory": True,
      "annual_revenue_xaf": Decimal("95000000")}, ["resto"],
     "Established restaurant with a loyal lunch clientele, fully equipped kitchen and staff willing to stay. Lease transferred.", False),
    ("businesses", "estate_agent", "Hair salon for sale, Molyko", "SALE", 4500000, 0, ("Molyko", "Buea"),
     {"size_sqm": Decimal("40"), "seating_capacity": 6, "includes_goodwill": True, "includes_inventory": True,
      "annual_revenue_xaf": Decimal("14000000")}, ["salon"], "Busy salon next to the university, sold with equipment and products.", False),
    ("businesses", "estate_agent", "Pharmacy depot for sale, Commercial Avenue", "SALE", 19000000, 0, ("Commercial Avenue", "Bamenda"),
     {"size_sqm": Decimal("70"), "includes_goodwill": True, "includes_inventory": True, "annual_revenue_xaf": Decimal("60000000")},
     ["pharmacy"], "Licensed pharmacy depot on Commercial Avenue; buyer must hold the required licence.", False),
]


class Command(BaseCommand):
    help = "Create realistic demo marketplace listings (goods, cars, shops, warehouses, businesses). --reset to recreate, --remove to delete."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Remove the demo listings first, then create them again.")
        parser.add_argument("--remove", action="store_true", help="Remove the demo listings and their sellers only.")

    def handle(self, *args, reset=False, remove=False, **options):
        from identity.models import User
        if reset or remove:
            removed = remove_demo_marketplace()
            self.stdout.write(f"Removed {removed} demo listing(s) and their demo sellers.")
            if remove:
                return
        elif User.objects.filter(username__startswith=PREFIX).exists():
            self.stdout.write(self.style.WARNING("Demo marketplace listings already exist; run with --reset to recreate them."))
            return
        count = create_demo_marketplace()
        self.stdout.write(self.style.SUCCESS(f"Created {count} demo marketplace listings."))


def remove_demo_marketplace() -> int:
    from identity.models import User
    from marketplace.models import MarketplaceListingBase, MarketplaceOrder
    from notifications.models import Notification
    from student_hostels.models import OwnerProfile

    users = User.objects.filter(username__startswith=PREFIX)
    with transaction.atomic():
        listings = MarketplaceListingBase.objects.filter(lister_user__in=users)
        if MarketplaceOrder.objects.filter(listing__in=listings).exists():
            raise CommandError("Someone has ordered a demo listing; cancel or settle those orders before removing the demo data.")
        count = listings.count()
        for listing in listings:
            listing.delete()
        OwnerProfile.objects.filter(account_user__in=users).delete()
        Notification.objects.filter(recipient__in=users).delete()
        users.delete()
    return count


def _quarter(place):
    from geo.models import Quarter
    name, town = place
    found = Quarter.objects.filter(name=name, village_or_district__name=town).first()
    if found is None:
        raise CommandError(f"Quarter {name} ({town}) is missing: run seed_cameroon_geography first.")
    return found


@transaction.atomic
def create_demo_marketplace() -> int:
    from identity.models import AgentProfile, User
    from marketplace.models import (
        BusinessListing, CarListing, GoodsListing, MarketplaceMedia, StoreListing, VehicleSpec, WarehouseListing,
    )
    from student_hostels.models import OwnerProfile, OwnerType

    sellers, profiles = {}, {}
    for key, (suffix, phone, first, last, is_agent) in SELLERS.items():
        user = User.objects.create(username=PREFIX + suffix, phone=phone, first_name=first, last_name=last)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        if is_agent:
            AgentProfile.objects.create(user=user, agent_commission_percent=Decimal("5"))
        sellers[key] = user
        profiles[key], _ = OwnerProfile.objects.get_or_create(account_user=user, defaults={"owner_type": OwnerType.LANDLORD})

    now = timezone.now()
    created = 0
    # Spread the creation times over the past weeks, so "newest first" looks like a live marketplace.
    def base(seller, title, description, price_basis, price, place, boosted, deposit=0):
        nonlocal created
        created += 1
        is_agent = hasattr(sellers[seller], "agent_profile")
        return dict(
            owner=profiles[seller], lister_user=sellers[seller], lister_role="AGENT" if is_agent else "OWNER",
            title=title, description=f"{description}\n\n{DEMO_NOTE}", price_basis=price_basis, price_xaf=Decimal(price),
            security_deposit_xaf=Decimal(deposit), quarter=_quarter(place), renewed_at=now - timedelta(hours=7 * created),
            boosted_until=now + timedelta(days=14) if boosted else None,
        )

    def add_photos(listing, keys):
        for order, key in enumerate(keys):
            MarketplaceMedia.objects.create(listing=listing, media_type="PHOTO", file_url=IMG.format(P[key]), order=order)

    for seller, title, category, condition, price, quantity, place, attributes, delivery, photos, description, boosted in GOODS:
        listing = GoodsListing.objects.create(
            **base(seller, title, description, "SALE", price, place, boosted),
            item_category=category, condition=condition, quantity=quantity, attributes=attributes, **delivery,
        )
        add_photos(listing, photos)

    for seller, title, price_basis, price, place, spec, terms, photos, description, boosted in CARS:
        listing = CarListing.objects.create(**base(seller, title, description, price_basis, price, place, boosted), **terms)
        VehicleSpec.objects.create(car_listing=listing, **spec)
        add_photos(listing, photos)

    models = {"stores": StoreListing, "warehouses": WarehouseListing, "businesses": BusinessListing}
    for category, seller, title, price_basis, price, deposit, place, extra, photos, description, boosted in PLACES:
        listing = models[category].objects.create(**base(seller, title, description, price_basis, price, place, boosted, deposit), **extra)
        add_photos(listing, photos)

    return created
