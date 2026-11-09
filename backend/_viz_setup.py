import sys
from rest_framework_simplejwt.tokens import RefreshToken
from identity.models import User
from careers.models import *

if sys.argv[1] == "setup":
    u, _ = User.objects.get_or_create(username="tmp_viz_admin", defaults={"phone": "+237600000999", "is_staff": True})
    u.is_staff = True
    u.save()
    p = TrainingProgram.objects.create(provider=u, title="TMP Viz Course", description="Temporary course for visual check.", category="TENANT_LAW", issues_certification=True)
    m = CourseModule.objects.create(program=p, title="Getting started", position=0)
    Lesson.objects.create(module=m, title="Welcome video", kind="VIDEO", position=0, video_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ", content_text="Watch to the end.")
    Lesson.objects.create(module=m, title="Reading", kind="TEXT", position=1, content_text="Some reading text.")
    q = Lesson.objects.create(module=m, title="Check quiz", kind="QUIZ", position=2)
    qq = QuizQuestion.objects.create(lesson=q, text="Pick one", position=0)
    QuizChoice.objects.create(question=qq, text="A", is_correct=True, position=0)
    QuizChoice.objects.create(question=qq, text="B", position=1)
    e = TrainingEnrollment.objects.create(program=p, student=u, status="IN_PROGRESS")
    LessonProgress.objects.create(enrollment=e, lesson=m.lessons.first())
    print("TOKEN", str(RefreshToken.for_user(u).access_token))
    print("PID", p.id)
else:
    TrainingProgram.objects.filter(title="TMP Viz Course").delete()
    User.objects.filter(username="tmp_viz_admin").delete()
    print("cleaned")
