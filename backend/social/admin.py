from oaziland.admin_base import register

from .models import Comment, Post, Rating, Review

# status is changed through the console's content tab, which records the takedown and tells the author.
register(Post, list_display=("id", "author", "post_type", "status", "published_at", "created_at"), list_filter=("status", "post_type"),
         search_fields=("id", "author__username", "caption"), readonly_fields=("status", "view_count"))
register(Comment, list_display=("id", "author", "post_id", "created_at"), search_fields=("author__username", "text"))
register(Review, list_display=("id", "author", "score", "created_at"), list_filter=("score",), search_fields=("author__username", "text"))
register(Rating, list_display=("id", "author", "subject_user", "score", "created_at"), search_fields=("author__username", "subject_user__username"))
