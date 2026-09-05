"""identity.serializers — registration and profile serializers."""
from rest_framework import serializers
from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    referral_code = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["id", "username", "phone", "email", "password", "preferred_language", "referral_code"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        referral_code = validated_data.pop("referral_code", "").strip()
        user = User(**validated_data)
        user.set_password(password)  # never store a plain-text password — Django's hashing, applied explicitly here
        user.save()

        if referral_code:
            # WHY a bad/unknown code never fails registration itself:
            # a typo in someone's referral code is a real, common thing
            # that should still let a person create their account —
            # just without a referral attached. The frontend can
            # separately tell them the code didn't match anything.
            from social.services import process_referral_signup, InvalidReferralCodeError
            try:
                process_referral_signup(new_user=user, referral_code=referral_code)
            except InvalidReferralCodeError:
                pass

        return user


class UserProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    account_status = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "phone", "email", "full_name", "preferred_language", "verification_status", "account_status"]
        read_only_fields = ["verification_status", "account_status"]
