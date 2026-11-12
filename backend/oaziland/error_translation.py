"""Translates known API error messages for French clients.

Messages are written in English at their raise sites; this middleware swaps in the
French text when the request's Accept-Language starts with "fr". Only exact matches
(FRENCH_ERRORS) or whole-message patterns (FRENCH_PATTERNS, for messages with a
variable part) in error responses (status >= 400) are touched, so user content is
never rewritten.
"""
import json
import re

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
    # careers: courses — enrolling and paying
    "Pay for this course to open it.": "Payez cette formation pour l'ouvrir.",
    "Payments are temporarily unavailable. Please try again later.": "Les paiements sont temporairement indisponibles. Veuillez réessayer plus tard.",
    "You're no longer enrolled in this course.": "Vous n'êtes plus inscrit à cette formation.",
    "This student is already enrolled in this program.": "Cet apprenant est déjà inscrit à cette formation.",
    "You are already enrolled in this course.": "Vous êtes déjà inscrit à cette formation.",
    "Enter the Mobile Money number to pay with.": "Saisissez le numéro Mobile Money à débiter.",
    "A payment for this course was just started. Check your phone.": "Un paiement pour cette formation vient d'être lancé. Vérifiez votre téléphone.",
    "A payment for this course is already waiting for your approval on your phone. Approve it, or try again in a few minutes.": "Un paiement pour cette formation attend déjà votre validation sur votre téléphone. Validez-le, ou réessayez dans quelques minutes.",
    "The payment could not be started. Check the number and try again.": "Le paiement n'a pas pu être lancé. Vérifiez le numéro et réessayez.",
    # careers: courses — lessons, quizzes and assignments
    "This lesson is not part of the course.": "Cette leçon ne fait pas partie de la formation.",
    "A quiz is completed by passing it.": "Un quiz est validé en le réussissant.",
    "An assignment is completed when a reviewer approves your submission.": "Un devoir est validé lorsqu'un correcteur approuve votre travail.",
    "This lesson is not an assignment.": "Cette leçon n'est pas un devoir.",
    "This assignment has already been approved.": "Ce devoir a déjà été approuvé.",
    "Attach your PDF as 'file'.": "Joignez votre fichier PDF.",
    "PDF files can be at most 20 MB.": "Les fichiers PDF ne peuvent pas dépasser 20 Mo.",
    "Upload a valid PDF file.": "Importez un fichier PDF valide.",
    "This lesson is not a quiz.": "Cette leçon n'est pas un quiz.",
    "This quiz has no questions yet.": "Ce quiz n'a pas encore de questions.",
    "You've already passed this quiz.": "Vous avez déjà réussi ce quiz.",
    "You've used all your attempts for now.": "Vous avez utilisé toutes vos tentatives pour le moment.",
    "answers must be an object of question id to selected choice ids.": "Le format des réponses est invalide.",
    "Finish every lesson and pass every quiz to complete this course.": "Terminez toutes les leçons et réussissez tous les quiz pour terminer cette formation.",
    # careers: courses — reviews, discussions, certificates and trainers
    "Sign in to review this course.": "Connectez-vous pour évaluer cette formation.",
    "Enroll in this course to join its discussions.": "Inscrivez-vous à cette formation pour participer à ses discussions.",
    "Only learners enrolled in this course can take part in its discussions.": "Seuls les apprenants inscrits à cette formation peuvent participer à ses discussions.",
    "That lesson is not part of this course.": "Cette leçon ne fait pas partie de la formation.",
    "Only the author can edit this post.": "Seul l'auteur peut modifier ce message.",
    "Only the author or the course staff can delete this post.": "Seuls l'auteur ou l'équipe de la formation peuvent supprimer ce message.",
    "No certificate with this code exists.": "Aucun certificat ne correspond à ce code.",
    "Trainer not found.": "Formateur introuvable.",
    "The headline must be 160 characters or fewer.": "Le titre du profil doit comporter 160 caractères au maximum.",
    "Enter a full website address starting with https://": "Saisissez une adresse de site complète commençant par https://",
    # careers: course management (admins, trainers, lecturers, supervisors)
    "Only an administrator can do this.": "Seul un administrateur peut faire cela.",
    "Only an administrator or the course's creator can change the course team.": "Seuls un administrateur ou le créateur de la formation peuvent modifier son équipe.",
    "An administrator needs to give you course-creator access first.": "Un administrateur doit d'abord vous donner l'accès à la création de formations.",
    "Only an administrator or the course lecturer can edit this course.": "Seuls un administrateur ou l'enseignant de la formation peuvent la modifier.",
    "An administrator reviews and publishes this course. Submit it for review instead.": "Un administrateur relit et publie cette formation. Soumettez-la plutôt pour relecture.",
    "Only an administrator or the course's creator can delete it.": "Seuls un administrateur ou le créateur de la formation peuvent la supprimer.",
    "Learners have enrolled in this course, so only an administrator can delete it. Unpublish it instead.": "Des apprenants sont inscrits à cette formation : seul un administrateur peut la supprimer. Dépubliez-la plutôt.",
    "Only the course's creator or lecturer can submit it for review.": "Seuls le créateur ou l'enseignant de la formation peuvent la soumettre pour relecture.",
    "This course is already published.": "Cette formation est déjà publiée.",
    "Add a description or some lessons before submitting the course.": "Ajoutez une description ou des leçons avant de soumettre la formation.",
    "You can't edit this course.": "Vous ne pouvez pas modifier cette formation.",
    "This learner paid for the course and finishing it pays you, so an administrator confirms their completion.": "Cet apprenant a payé la formation et sa validation vous rémunère : c'est donc un administrateur qui confirme qu'il l'a terminée.",
    "This is the quiz's last question and the course is published, so learners would have a quiz they can't pass. Add the new question first, or unpublish the course.": "C'est la dernière question du quiz et la formation est publiée : les apprenants auraient un quiz impossible à réussir. Ajoutez d'abord la nouvelle question, ou dépubliez la formation.",
    "Choose approve or request changes.": "Choisissez d'approuver ou de demander des modifications.",
    "Tell the learner what needs to change.": "Indiquez à l'apprenant ce qui doit être modifié.",
    "Questions can only be added to a quiz lesson.": "Les questions ne peuvent être ajoutées qu'à une leçon de type quiz.",
    "A question needs at least two choices.": "Une question doit avoir au moins deux choix.",
    "Mark at least one choice as correct.": "Indiquez au moins une bonne réponse.",
    "Video files can be at most 500 MB.": "Les fichiers vidéo ne peuvent pas dépasser 500 Mo.",
    "Upload a valid MP4, WebM, OGG or MOV video.": "Importez une vidéo MP4, WebM, OGG ou MOV valide.",
    "The pass mark must be between 1 and 100.": "La note de réussite doit être comprise entre 1 et 100.",
    "Cover images can be at most 10 MB.": "Les images de couverture ne peuvent pas dépasser 10 Mo.",
    "Upload a JPEG, PNG or WebP image.": "Importez une image JPEG, PNG ou WebP.",
    "No user found with that username, phone number or email.": "Aucun utilisateur ne correspond à ce nom d'utilisateur, ce numéro de téléphone ou cet e-mail.",
    "Administrators can already create courses.": "Les administrateurs peuvent déjà créer des formations.",
    "This certificate template doesn't exist.": "Ce modèle de certificat n'existe pas.",
    # careers: the certificate designer (admins)
    "Give the template a name.": "Donnez un nom au modèle.",
    "Choose landscape or portrait.": "Choisissez paysage ou portrait.",
    "Choose a file to upload.": "Choisissez un fichier à importer.",
    "The layout must be a list of elements.": "La mise en page doit être une liste d'éléments.",
    "Unknown element type.": "Type d'élément inconnu.",
    "The file is too large (15 MB maximum).": "Le fichier est trop volumineux (15 Mo maximum).",
    "This PDF could not be read. Export it again or upload it as a PNG or JPG image.": "Ce PDF n'a pas pu être lu. Exportez-le à nouveau ou importez-le en image PNG ou JPG.",
    "Upload the blank certificate as a PDF, PNG or JPG file.": "Importez le certificat vierge au format PDF, PNG ou JPG.",
    "Upload the logo as a PNG (ideally with a transparent background) or JPG image.": "Importez le logo en image PNG (idéalement sur fond transparent) ou JPG.",
    "Upload the signature as a PNG (with a transparent background) or JPG image.": "Importez la signature en image PNG (sur fond transparent) ou JPG.",
    "The signature is empty.": "La signature est vide.",
    # careers: jobs
    "You have already applied to this job posting.": "Vous avez déjà postulé à cette offre.",
    "Only the job's poster can view its applications.": "Seul l'auteur de l'offre peut voir ses candidatures.",
    "Only the job's poster can update an application's status.": "Seul l'auteur de l'offre peut modifier le statut d'une candidature.",
    "That application was not found on this job posting.": "Cette candidature est introuvable pour cette offre.",
}

# Messages with a variable part (a status, a price, quiz titles, a limit): (pattern, French template). Groups are
# re-inserted as they are, except the ones the template translates through _VALUE_FR.
_VALUE_FR = {
    # enrollment statuses (TrainingEnrollmentStatus labels, lower-cased)
    "awaiting payment": "en attente de paiement", "enrolled": "active", "in progress": "en cours",
    "completed": "terminée", "dropped": "abandonnée",
    # actions on an enrollment (careers.services._require_status)
    "start": "commencer", "complete": "terminer",
    # what a discussion post is called (careers.course_discussions._clean)
    "title": "titre", "question": "question", "reply": "réponse", "message": "message",
}
_FEMININE = {"question", "reply"}


def _fr(value):
    return _VALUE_FR.get(value, value)


def _discussion_noun(label, definite=False):
    noun = _fr(label)
    if definite:
        return ("La " if label in _FEMININE else "Le ") + noun
    return ("une " if label in _FEMININE else "un ") + noun


FRENCH_PATTERNS = [
    (re.compile(r"Cannot make progress on an enrollment that is (.+)\."),
     lambda m: f"Impossible d'avancer : cette inscription est {_fr(m[1])}."),
    (re.compile(r"Cannot (start|complete) an enrollment that is (.+)\."),
     lambda m: f"Impossible de {_fr(m[1])} : cette inscription est {_fr(m[2])}."),
    (re.compile(r"This course costs (\d+) XAF\. Pay for it to enroll\."),
     lambda m: f"Cette formation coûte {m[1]} XAF. Payez-la pour vous inscrire."),
    (re.compile(r"Add at least one question to every quiz first\. Without questions: (.+)\."),
     lambda m: f"Ajoutez d'abord au moins une question à chaque quiz. Sans question : {m[1]}."),
    (re.compile(r"Write a (title|question|reply|message)\."),
     lambda m: f"Écrivez {_discussion_noun(m[1])}."),
    (re.compile(r"The (title|question|reply|message) must be (\d+) characters or fewer\."),
     lambda m: f"{_discussion_noun(m[1], definite=True)} doit comporter {m[2]} caractères au maximum."),
    (re.compile(r"The bio must be (\d+) characters or fewer\."),
     lambda m: f"La biographie doit comporter {m[1]} caractères au maximum."),
    (re.compile(r"'(.+)' must be a number\."), lambda m: f"« {m[1]} » doit être un nombre."),
    (re.compile(r"'(.+)' is not a colour like #1B2A4A\."), lambda m: f"« {m[1]} » n'est pas une couleur au format #1B2A4A."),
    (re.compile(r"A certificate can have at most (\d+) elements\."), lambda m: f"Un certificat peut contenir au maximum {m[1]} éléments."),
    (re.compile(r"Unknown font '(.+)'\."), lambda m: f"Police inconnue : « {m[1]} »."),
    (re.compile(r"Unknown alignment '(.+)'\."), lambda m: f"Alignement inconnu : « {m[1]} »."),
]


def _translate(value):
    if isinstance(value, str):
        if value in FRENCH_ERRORS:
            return FRENCH_ERRORS[value]
        for pattern, french in FRENCH_PATTERNS:
            match = pattern.fullmatch(value)
            if match:
                return french(match)
        return value
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
