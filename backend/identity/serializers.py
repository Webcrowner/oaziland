"""identity.serializers — registration and profile serializers."""
from rest_framework import serializers
from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["id", "username", "phone", "email", "password", "preferred_language"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)  # never store a plain-text password — Django's hashing, applied explicitly here
        user.save()
        return user


class UserProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    account_status = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "phone", "email", "full_name", "preferred_language", "verification_status", "account_status"]
        read_only_fields = ["verification_status", "account_status"]
