"""Translates known API error messages for French clients.

Messages are written in English at their raise sites; this middleware swaps in the
French text when the request's Accept-Language starts with "fr". Only exact matches
in error responses (status >= 400) are touched, so user content is never rewritten.
"""
import json

FRENCH_ERRORS = {
    # services: technician registration and job lifecycle
    "You are already registered as a technician.": "Vous êtes déjà inscrit comme technicien.",
    "You have not registered as a technician yet.": "Vous n'êtes pas encore inscrit comme technicien.",
    "You must register as a technician before accepting a job.": "Vous devez vous inscrire comme technicien avant d'accepter un travail.",
    "Your technician registration is still awaiting verification.": "Votre inscription de technicien est encore en attente de vérification.",
    "You cannot accept your own request.": "Vous ne pouvez pas accepter votre propre demande.",
    "This job is outside your registered specialties.": "Ce travail est en dehors de vos spécialités enregistrées.",
    "This request is no longer available to accept.": "Cette demande n'est plus disponible.",
    "Only the request's own technician can do this.": "Seul le technicien assigné à cette demande peut faire cela.",
    "Work has already started — raise a dispute instead of releasing the job.": "Le travail a déjà commencé — ouvrez un litige au lieu de libérer le travail.",
    "The job must be accepted (and not yet en route) first.": "Le travail doit d'abord être accepté (et le technicien pas encore en route).",
    "A quote can only be set on an active job.": "Un devis ne peut être établi que sur un travail actif.",
    "The quote must be greater than zero.": "Le devis doit être supérieur à zéro.",
    "Only the requester can approve the quote.": "Seul le demandeur peut approuver le devis.",
    "There is no quote to approve yet.": "Il n'y a pas encore de devis à approuver.",
    "The quote can only be approved while the job is active.": "Le devis ne peut être approuvé que pendant que le travail est actif.",
    "Only the requester or the assigned technician can reschedule this job.": "Seuls le demandeur ou le technicien assigné peuvent replanifier ce travail.",
    "A job can only be rescheduled before work has started.": "Un travail ne peut être replanifié qu'avant le début des travaux.",
    "Only the requester can reschedule an unaccepted job.": "Seul le demandeur peut replanifier un travail non accepté.",
    "The new time must be in the future.": "La nouvelle heure doit être dans le futur.",
    "Only the requester or the assigned technician can chat on this job.": "Seuls le demandeur ou le technicien assigné peuvent discuter sur ce travail.",
    "Only the requester or the assigned technician can dispute this job.": "Seuls le demandeur ou le technicien assigné peuvent ouvrir un litige sur ce travail.",
    "Only an active job can be disputed.": "Seul un travail actif peut faire l'objet d'un litige.",
    "Only the requester can rate this job's technician.": "Seul le demandeur peut noter le technicien de ce travail.",
    "You can rate the technician once the job is completed.": "Vous pouvez noter le technicien une fois le travail terminé.",
    "This request can no longer be cancelled — a technician has already accepted it.": "Cette demande ne peut plus être annulée — un technicien l'a déjà acceptée.",
    "Only the requester or the assigned technician can add photos to this job.": "Seuls le demandeur ou le technicien assigné peuvent ajouter des photos à ce travail.",
    "Only the request's own requester can cancel it.": "Seul le demandeur de cette demande peut l'annuler.",
    "Only the request's own technician can start it.": "Seul le technicien assigné à cette demande peut la démarrer.",
    "This request must be accepted before it can start.": "Cette demande doit être acceptée avant de pouvoir démarrer.",
    "The requester must approve your quote before work can start.": "Le demandeur doit approuver votre devis avant le début des travaux.",
    "Only the request's own requester can complete payment for it.": "Seul le demandeur de cette demande peut en effectuer le paiement.",
    "This request must be in progress before it can be completed.": "Cette demande doit être en cours avant de pouvoir être terminée.",
    "There is no approved quote for this job.": "Il n'y a pas de devis approuvé pour ce travail.",
    "A receipt is available once the job is completed and paid.": "Un reçu est disponible une fois le travail terminé et payé.",
    "This technician has not uploaded any credential documents yet.": "Ce technicien n'a pas encore téléversé de justificatifs.",
    "Provide a quarter or a GPS location so technicians can find you.": "Indiquez un quartier ou une position GPS pour que les techniciens puissent vous trouver.",
    "Provide amount_xaf, or labor_xaf with optional materials_xaf.": "Indiquez amount_xaf, ou labor_xaf avec materials_xaf facultatif.",
    "materials_xaf needs labor_xaf.": "materials_xaf nécessite labor_xaf.",
    # services: facility contracts and projects
    "Only this contract's owner or assigned technician can log a visit.": "Seul le propriétaire du contrat ou le technicien assigné peut enregistrer une visite.",
    "Only this project's owner can link a technician.": "Seul le propriétaire du projet peut lier un technicien.",
    "Only this project's owner can add a milestone.": "Seul le propriétaire du projet peut ajouter une étape.",
    "Only this project's owner or an assigned technician can complete a milestone.": "Seul le propriétaire du projet ou un technicien assigné peut terminer une étape.",
    "Milestone not found on this project.": "Étape introuvable sur ce projet.",
    "No such user.": "Utilisateur introuvable.",
    "Not found.": "Introuvable.",
    # common DRF messages
    "This field is required.": "Ce champ est obligatoire.",
    "Authentication credentials were not provided.": "Les identifiants d'authentification n'ont pas été fournis.",
    "You do not have permission to perform this action.": "Vous n'avez pas la permission d'effectuer cette action.",
}


def _translate(value):
    if isinstance(value, str):
        return FRENCH_ERRORS.get(value, value)
    if isinstance(value, list):
        return [_translate(item) for item in value]
    if isinstance(value, dict):
        return {key: _translate(item) for key, item in value.items()}
    return value


class FrenchErrorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        language = request.headers.get("Accept-Language", "").strip().lower()
        if (
            not language.startswith("fr") or response.status_code < 400
            or "application/json" not in response.get("Content-Type", "")
        ):
            return response
        try:
            payload = json.loads(response.content)
        except ValueError:
            return response
        response.content = json.dumps(_translate(payload), ensure_ascii=False)
        return response
