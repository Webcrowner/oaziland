"""
careers.certificate_template_views — the admin certificate designer's API (/api/admin/certificate-templates/).

Admins create templates (from the built-in design or an empty page), upload a blank certificate (PDF or image) as
the background, change the logo, move/resize/restyle elements, preview the result with sample data, and choose
which template the system uses for every certificate it issues.
"""
import uuid

from django.core.files.base import ContentFile
from django.db import transaction
from django.http import HttpResponse
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from oaziland.permissions import IsAdminRole
from . import certificate_templates as templates
from .models import CertificateOrientation, CertificateTemplate


def _url(request, field):
    return request.build_absolute_uri(field.url) if field else ""


def _payload(request, template):
    return {
        "id": str(template.id),
        "name": template.name,
        "orientation": template.orientation,
        "background_color": template.background_color,
        "background_image_url": _url(request, template.background_image),
        "logo_url": _url(request, template.logo),
        "signature_url": _url(request, template.signature),
        "layout": template.layout,
        "is_active": template.is_active,
        "course_count": template.courses.count(),
        "updated_at": template.updated_at,
    }


def _bad(error):
    return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)


class CertificateTemplateViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _get(self, pk):
        try:
            return CertificateTemplate.objects.get(pk=uuid.UUID(str(pk)))
        except (ValueError, CertificateTemplate.DoesNotExist):
            return None

    def list(self, request):
        items = [_payload(request, t) for t in CertificateTemplate.objects.all()]
        return Response({
            "results": items,
            "builtin_active": not any(item["is_active"] for item in items),
            "default_layout": templates.default_layout(),
            "default_background_color": templates.DEFAULT_BACKGROUND,
            "placeholders": list(templates.PLACEHOLDERS),
        })

    def create(self, request):
        name = str(request.data.get("name", "")).strip()[:120]
        if not name:
            return _bad("Give the template a name.")
        start_empty = request.data.get("start_from") == "empty"
        template = CertificateTemplate.objects.create(
            name=name,
            layout=[] if start_empty else templates.default_layout(),
            background_color="#FFFFFF" if start_empty else templates.DEFAULT_BACKGROUND,
            created_by=request.user,
        )
        return Response(_payload(request, template), status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(_payload(request, template))

    def _apply(self, template, data):
        """Copies the editable settings from data onto template (unsaved); raises TemplateError."""
        if "name" in data:
            name = str(data["name"]).strip()[:120]
            if not name:
                raise templates.TemplateError("Give the template a name.")
            template.name = name
        if "orientation" in data:
            if data["orientation"] not in CertificateOrientation.values:
                raise templates.TemplateError("Choose landscape or portrait.")
            if data["orientation"] != template.orientation and "layout" not in data:
                ratio = templates.design_height(data["orientation"]) / templates.design_height(template.orientation)
                template.layout = templates.clean_layout(_rescale(template.layout, ratio), data["orientation"])
            template.orientation = data["orientation"]
        if "background_color" in data:
            template.background_color = templates.clean_color(data["background_color"])
        if "layout" in data:
            template.layout = templates.clean_layout(data["layout"], template.orientation)

    def partial_update(self, request, pk=None):
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            self._apply(template, request.data)
        except templates.TemplateError as error:
            return _bad(error)
        template.save()
        return Response(_payload(request, template))

    def destroy(self, request, pk=None):
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        for field in (template.background_image, template.logo, template.signature):
            if field:
                field.delete(save=False)
        template.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        """Makes this the template used for every certificate the system issues from now on (certificates already
        issued keep the design frozen when they were issued)."""
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            CertificateTemplate.objects.filter(is_active=True).exclude(pk=template.pk).update(is_active=False)
            template.is_active = True
            template.save(update_fields=["is_active", "updated_at"])
        return Response(_payload(request, template))

    @action(detail=False, methods=["post"], url_path="use-builtin")
    def use_builtin(self, request):
        CertificateTemplate.objects.filter(is_active=True).update(is_active=False)
        return Response({"builtin_active": True})

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        source = self._get(pk)
        if source is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        copy = CertificateTemplate(
            name=f"{source.name} (copy)"[:120], orientation=source.orientation, background_color=source.background_color,
            layout=source.layout, created_by=request.user,
        )
        for field in ("background_image", "logo", "signature"):
            original = getattr(source, field)
            if original:
                original.open("rb")
                try:
                    getattr(copy, field).save(original.name.rsplit("/", 1)[-1], ContentFile(original.read()), save=False)
                finally:
                    original.close()
        copy.save()
        return Response(_payload(request, copy), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post", "delete"])
    def background(self, request, pk=None):
        """POST a blank certificate (file: PDF or image) to draw on; DELETE to go back to a plain colour."""
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if template.background_image:
            if request.method == "DELETE":
                template.background_image.delete(save=False)
        if request.method == "POST":
            upload = request.FILES.get("file")
            if upload is None:
                return _bad("Choose a file to upload.")
            try:
                png, orientation = templates.background_from_upload(upload)
            except templates.TemplateError as error:
                return _bad(error)
            if template.background_image:
                template.background_image.delete(save=False)
            if orientation != template.orientation:
                ratio = templates.design_height(orientation) / templates.design_height(template.orientation)
                template.layout = templates.clean_layout(_rescale(template.layout, ratio), orientation)
                template.orientation = orientation
            template.background_image.save(f"background-{template.id.hex[:8]}.png", ContentFile(png), save=False)
        template.save()
        return Response(_payload(request, template))

    @action(detail=True, methods=["post", "delete"])
    def logo(self, request, pk=None):
        """POST a new logo (file: image); DELETE to go back to the Oaziland logo."""
        return self._replace_image(request, pk, "logo", templates.logo_from_upload)

    @action(detail=True, methods=["post", "delete"])
    def signature(self, request, pk=None):
        """POST a signature (file: image — drawn in the designer, or a scan with its background removed); DELETE to
        remove it (signature elements are then left out of the certificate)."""
        return self._replace_image(request, pk, "signature", templates.signature_from_upload)

    def _replace_image(self, request, pk, field_name, convert):
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        png = None
        if request.method == "POST":
            upload = request.FILES.get("file")
            if upload is None:
                return _bad("Choose a file to upload.")
            try:
                png = convert(upload)
            except templates.TemplateError as error:
                return _bad(error)
        field = getattr(template, field_name)
        if field:
            field.delete(save=False)
        if png is not None:
            field.save(f"{field_name}-{template.id.hex[:8]}.png", ContentFile(png), save=False)
        template.save()
        return Response(_payload(request, template))

    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        """POST the designer's current (possibly unsaved) settings; returns a PNG filled with sample data, drawn
        exactly as issued certificates will be."""
        template = self._get(pk)
        if template is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            self._apply(template, request.data)  # never saved
        except templates.TemplateError as error:
            return _bad(error)
        locale = "fr" if request.data.get("locale") == "fr" else "en"
        image = templates.render(template, templates.sample_values(locale), locale)
        return HttpResponse(templates.to_png(image, max_width=1400), content_type="image/png")


def _rescale(layout, ratio):
    """Keeps elements on the page when the orientation changes (the page height changes, the width doesn't)."""
    scaled = []
    for element in layout:
        element = dict(element)
        element["y"] = element.get("y", 0) * ratio
        if "h" in element:
            element["h"] = element["h"] * ratio
        scaled.append(element)
    return scaled
