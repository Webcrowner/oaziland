"""
flyers.views — the real gap this closes: generate_flyer() already
composes a genuine, printable PNG (real QR code, real logo/headline
layout via Pillow) and saves it as a real file — nothing ever exposed
this over HTTP, despite the feature being fully built.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from .models import Flyer
from .serializers import FlyerSerializer, FlyerCreateSerializer
from .services import generate_flyer


class FlyerViewSet(viewsets.ModelViewSet):
    """create/list/retrieve only — a flyer is generated once and kept;
    there's no real 'update' operation on an already-composed image.
    Scoped to the requester's own flyers."""
    serializer_class = FlyerSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Flyer.objects.none()
        return Flyer.objects.filter(created_by=self.request.user).order_by("-created_at")

    @extend_schema(request=FlyerCreateSerializer, responses={201: FlyerSerializer, 400: dict})
    def create(self, request, *args, **kwargs):
        input_serializer = FlyerCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            flyer = generate_flyer(created_by=request.user, **input_serializer.validated_data)
        except (ValueError, KeyError) as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(FlyerSerializer(flyer).data, status=status.HTTP_201_CREATED)
