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
    # admin console safeguards and withdrawals
    "You cannot suspend or warn your own account.": "Vous ne pouvez pas suspendre ni avertir votre propre compte.",
    "Administrators cannot be suspended or warned. Remove their admin role first.": "Les administrateurs ne peuvent être ni suspendus ni avertis. Retirez d'abord leur rôle d'administrateur.",
    "days must be a whole number between 1 and 365.": "Le nombre de jours doit être un entier compris entre 1 et 365.",
    "The strike reason must be between 1 and 30 characters.": "Le motif de l'avertissement doit comporter entre 1 et 30 caractères.",
    "Only a full-access administrator can grant or remove the admin role.": "Seul un administrateur à accès complet peut attribuer ou retirer le rôle d'administrateur.",
    "Only a full-access administrator can do this.": "Seul un administrateur à accès complet peut effectuer cette action.",
    "You cannot remove your own admin role.": "Vous ne pouvez pas retirer votre propre rôle d'administrateur.",
    "Please enter a valid email address.": "Veuillez saisir une adresse e-mail valide.",
    "Your name or message is too long.": "Votre nom ou votre message est trop long.",
    "That reply is too long.": "Cette réponse est trop longue.",
    "name, email, and message are all required.": "Le nom, l'e-mail et le message sont tous obligatoires.",
    "message is required.": "Le message est obligatoire.",
    "This is the last administrator; the platform must always have one.": "C'est le dernier administrateur ; la plateforme doit toujours en avoir un.",
    "This boost option is not available right now.": "Cette option de mise en avant n'est pas disponible pour le moment.",
    "No pricing tier configured for this placement/duration combination yet.": "Aucun tarif n'est défini pour cette option de mise en avant.",
    "Unknown fee category.": "Catégorie de frais inconnue.",
    "Verify your identity (KYC) before withdrawing money.": "Vérifiez votre identité (KYC) avant de retirer de l'argent.",
    "Your identity verification is still under review. You can withdraw once it is approved.": "La vérification de votre identité est en cours. Vous pourrez retirer de l'argent une fois qu'elle sera approuvée.",
    "Your identity verification was rejected. Please resubmit your details before withdrawing.": "La vérification de votre identité a été rejetée. Veuillez soumettre à nouveau vos informations avant de retirer de l'argent.",
    "Insufficient wallet balance for this withdrawal.": "Solde du portefeuille insuffisant pour ce retrait.",
    "Only a pending withdrawal can be approved.": "Seul un retrait en attente peut être approuvé.",
    "Only a pending withdrawal can be rejected.": "Seul un retrait en attente peut être rejeté.",
    "A reason is required to reject a withdrawal.": "Un motif est requis pour rejeter un retrait.",
    "This withdrawal has already been resolved.": "Ce retrait a déjà été traité.",
    # published content, AI flags and neighbourhood requests
    "A reason is required to remove content.": "Un motif est requis pour retirer un contenu.",
    "The reason must be 500 characters or fewer.": "Le motif doit comporter 500 caractères au maximum.",
    "That item no longer exists.": "Cet élément n'existe plus.",
    "This item is not published, so there is nothing to remove.": "Cet élément n'est pas publié, il n'y a donc rien à retirer.",
    "This item has already been removed.": "Cet élément a déjà été retiré.",
    "This item was not removed by a moderator.": "Cet élément n'a pas été retiré par un modérateur.",
    "Unknown content type or id.": "Type de contenu ou identifiant inconnu.",
    "Unknown content type or state.": "Type de contenu ou état inconnu.",
    "Unknown state.": "État inconnu.",
    "This item has no open flags.": "Cet élément n'a aucun signalement ouvert.",
    "This request has already been reviewed.": "Cette demande a déjà été examinée.",
    "A reason is required to reject a verification request.": "Un motif est requis pour rejeter une demande de vérification.",
    "Unknown state or type.": "État ou type inconnu.",
    "You do not have an agent account to verify.": "Vous n'avez pas de compte agent à vérifier.",
    "You do not have an agency account to verify.": "Vous n'avez pas de compte agence à vérifier.",
    "You do not have a landlord account to verify.": "Vous n'avez pas de compte propriétaire à vérifier.",
    "You can only request verification for your own account.": "Vous ne pouvez demander la vérification que de votre propre compte.",
    "You can only request verification for your own student hostel.": "Vous ne pouvez demander la vérification que de votre propre résidence étudiante.",
    "You can only request verification for your own guest house.": "Vous ne pouvez demander la vérification que de votre propre maison d'hôtes.",
    "You can only request verification for your own business listing.": "Vous ne pouvez demander la vérification que de votre propre annonce d'entreprise.",
    "You can only request verification for your own car listing.": "Vous ne pouvez demander la vérification que de votre propre annonce de voiture.",
    "Identity is verified through the ID check, not through this form.": "L'identité est vérifiée par le contrôle d'identité, pas par ce formulaire.",
    "Choose what you want verified.": "Choisissez ce que vous voulez faire vérifier.",
    "Unknown verification type.": "Type de vérification inconnu.",
    "Attach a document so the team can check your request.": "Joignez un document pour que l'équipe puisse examiner votre demande.",
    "The document link is too long.": "Le lien du document est trop long.",
    "The document link must be a secure (https) web address.": "Le lien du document doit être une adresse web sécurisée (https).",
    "You already have a request waiting for review for this.": "Vous avez déjà une demande en attente d'examen pour cet élément.",
    "This is already verified.": "Cet élément est déjà vérifié.",
    "The item being verified no longer exists.": "L'élément à vérifier n'existe plus.",
    "This caterer is already verified.": "Ce traiteur est déjà vérifié.",
    "This caterer is not verified.": "Ce traiteur n'est pas vérifié.",
    "You asked for an export a few minutes ago. Download that one, or try again shortly.": "Vous avez demandé un export il y a quelques minutes. Téléchargez-le, ou réessayez dans un instant.",
    "This export is no longer available. Ask for a new one.": "Cet export n'est plus disponible. Demandez-en un nouveau.",
    "Administrator accounts cannot be deleted this way. Remove the admin role first.": "Les comptes administrateurs ne peuvent pas être supprimés ainsi. Retirez d'abord le rôle d'administrateur.",
    "That password is not correct.": "Ce mot de passe est incorrect.",
    "Type your username exactly to confirm the deletion.": "Saisissez exactement votre nom d'utilisateur pour confirmer la suppression.",
    "Type the account's username exactly to confirm the deletion.": "Saisissez exactement le nom d'utilisateur du compte pour confirmer la suppression.",
    "Choose a period of 7, 30, 90 or 365 days.": "Choisissez une période de 7, 30, 90 ou 365 jours.",
    # student hostel rooms
    "Enter the institution's name.": "Saisissez le nom de l'établissement.",
    "The institution's name must be 200 characters or fewer.": "Le nom de l'établissement doit comporter 200 caractères au maximum.",
    "Students are housed under this institution's semesters. End those allocations first.": "Des étudiants sont logés sur les semestres de cet établissement. Mettez d'abord fin à ces attributions.",
    "Add the institution to this hostel first.": "Ajoutez d'abord l'établissement à cette résidence.",
    "Give the semester a name of up to 100 characters.": "Donnez au semestre un nom de 100 caractères au maximum.",
    "The semester must end after it starts.": "Le semestre doit se terminer après son début.",
    "The billing date must fall between 90 days before the start and the end of the semester.": "La date de facturation doit se situer entre 90 jours avant le début et la fin du semestre.",
    "This institution already has a semester with that name.": "Cet établissement a déjà un semestre portant ce nom.",
    "Give the room a code of up to 50 characters, e.g. A-101.": "Donnez à la chambre un code de 50 caractères au maximum, par ex. A-101.",
    "Choose a room type and how it is let.": "Choisissez un type de chambre et son mode de location.",
    "A room has between 1 and 20 beds.": "Une chambre compte entre 1 et 20 lits.",
    "This hostel already has a room with that code.": "Cette résidence a déjà une chambre avec ce code.",
    "Students have been housed in this room, so it is kept for the record.": "Des étudiants ont été logés dans cette chambre ; elle est donc conservée pour l'historique.",
    "No account was found with that username or phone number.": "Aucun compte ne correspond à ce nom d'utilisateur ou ce numéro de téléphone.",
    "Administrator accounts cannot be given a room.": "Les comptes administrateurs ne peuvent pas recevoir de chambre.",
    "Choose one of this hostel's semesters.": "Choisissez l'un des semestres de cette résidence.",
    "Choose one of this hostel's rooms.": "Choisissez l'une des chambres de cette résidence.",
    "Choose one of this hostel's institutions.": "Choisissez l'un des établissements de cette résidence.",
    "This room is full for that semester.": "Cette chambre est complète pour ce semestre.",
    "That room is full for this semester.": "Cette chambre est complète pour ce semestre.",
    "Say why the allocation is ending; the student will see it.": "Indiquez pourquoi l'attribution prend fin ; l'étudiant le verra.",
    "This allocation has already ended.": "Cette attribution a déjà pris fin.",
    "The student is already in this room.": "L'étudiant est déjà dans cette chambre.",
    "That allocation was not found in this hostel.": "Cette attribution est introuvable dans cette résidence.",
    "Enter the start, end and billing dates.": "Saisissez les dates de début, de fin et de facturation.",
    "Please keep the reason under 500 characters.": "Le motif doit faire moins de 500 caractères.",
    "Your account is already scheduled for deletion.": "Votre compte est déjà programmé pour suppression.",
    "This account has already been deleted.": "Ce compte a déjà été supprimé.",
    "Only a scheduled deletion can be cancelled.": "Seule une suppression programmée peut être annulée.",
    "A reason is required to stop a user's deletion.": "Un motif est requis pour arrêter la suppression d'un compte.",
    "Only a scheduled deletion can be completed.": "Seule une suppression programmée peut être effectuée.",
    "This account still has money or an open deal on the platform. Settle it first.": "Ce compte a encore de l'argent ou une transaction en cours sur la plateforme. Réglez-la d'abord.",
    "Only a full-access administrator can delete an account early.": "Seul un administrateur à accès complet peut supprimer un compte de manière anticipée.",
    "A reason is required to decline a request.": "Un motif est requis pour refuser une demande.",
    "The reason must be 300 characters or fewer.": "Le motif doit comporter 300 caractères au maximum.",
    "The neighbourhood name cannot be empty.": "Le nom du quartier ne peut pas être vide.",
    "The city name cannot be empty.": "Le nom de la ville ne peut pas être vide.",
    "The neighbourhood name must be 100 characters or fewer.": "Le nom du quartier doit comporter 100 caractères au maximum.",
    "The city name must be 100 characters or fewer.": "Le nom de la ville doit comporter 100 caractères au maximum.",
    "Choose a region from the list.": "Choisissez une région dans la liste.",
    "This area already exists — pick it from the dropdown.": "Ce quartier existe déjà — choisissez-le dans la liste.",
    "This area has already been requested and is awaiting review.": "Ce quartier a déjà été demandé et est en cours d'examen.",
    "You cannot report yourself.": "Vous ne pouvez pas vous signaler vous-même.",
    "You cannot report your own listing.": "Vous ne pouvez pas signaler votre propre annonce.",
    "You cannot report your own post.": "Vous ne pouvez pas signaler votre propre publication.",
    "You cannot report your own content.": "Vous ne pouvez pas signaler votre propre contenu.",
    "You have already reported this listing. Our team is reviewing it.": "Vous avez déjà signalé cette annonce. Notre équipe l'examine.",
    "You have already reported this. Our team is reviewing it.": "Vous l'avez déjà signalé. Notre équipe l'examine.",
    "That item was not found. It may already have been removed.": "Élément introuvable. Il a peut-être déjà été retiré.",
    "That post was not found.": "Publication introuvable.",
    "That user was not found.": "Utilisateur introuvable.",
    "This payment has already been settled.": "Ce paiement a déjà été réglé.",
    "This dispute has already been resolved.": "Ce litige a déjà été résolu.",
    "Enter how much goes back to the payer.": "Indiquez le montant à rembourser au payeur.",
    "Enter the refund as a number of francs.": "Indiquez le remboursement en francs.",
    "Enter the refund in whole francs.": "Indiquez le remboursement en francs entiers.",
    "The refund must be between 0 and the amount paid.": "Le remboursement doit être compris entre 0 et le montant payé.",
    "For a split, the refund must be more than 0 and less than the amount paid.": "Pour un partage, le remboursement doit être supérieur à 0 et inférieur au montant payé.",
    "Couldn't find who should be paid for this booking, so nothing was moved.": "Impossible de trouver le bénéficiaire de cette réservation : aucun montant n'a été versé.",
    "outcome must be RELEASE, REFUND or SPLIT.": "La décision doit être RELEASE, REFUND ou SPLIT.",
    "Sign in to write a review.": "Connectez-vous pour écrire un avis.",
    "Choose a score from 1 to 5 stars.": "Choisissez une note de 1 à 5 étoiles.",
    "Your review must be 2000 characters or fewer.": "Votre avis doit comporter 2000 caractères au maximum.",
    "You can't review your own place.": "Vous ne pouvez pas évaluer votre propre établissement.",
    "You have already reviewed this place.": "Vous avez déjà évalué cet établissement.",
    "Only students who have had a room here can review this hostel.": "Seuls les étudiants qui y ont eu une chambre peuvent évaluer cette résidence.",
    "Only organisers whose event here has taken place can review this venue.": "Seuls les organisateurs dont l'événement a eu lieu ici peuvent évaluer ce lieu.",
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
