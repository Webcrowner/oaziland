"""The seller dashboard endpoints: overview, payout history and the CSV export (see seller_dashboard.py)."""
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import seller_dashboard as dash


def _period(request) -> str:
    period = request.query_params.get("period", dash.DEFAULT_PERIOD)
    if period not in dash.PERIODS:
        raise ValidationError({"period": f"Choose one of: {', '.join(dash.PERIODS)}."})
    return period


class SellerDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict, 400: dict})
    def get(self, request):
        return Response(dash.dashboard(request.user, _period(request)))


class SellerPayoutsView(APIView):
    """What reached the seller's wallet, one row per sale with the platform fee taken (?period=7d|30d|90d|365d|all)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict, 400: dict})
    def get(self, request):
        since = dash.period_start(_period(request))
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(dash.payouts(request.user, since), request, view=self)
        return paginator.get_paginated_response([dash.payout_row(order) for order in page])


class SellerSalesCsvView(APIView):
    """Every order on the seller's listings in the period as a CSV (UTF-8 with a BOM, so Excel shows accents right)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict, 400: dict})
    def get(self, request):
        period = _period(request)
        body = "\ufeff" + dash.sales_csv(request.user, dash.period_start(period))
        response = HttpResponse(body, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="oaziland-sales-{period}-{timezone.localdate():%Y%m%d}.csv"'
        return response
