from __future__ import annotations

from functools import reduce
from typing import Any, cast

from django.db import router
from django.db.models import Model, Q
from django.db.models.expressions import CombinedExpression
from django.db.models.signals import post_save

from .utils import resolve_combined_expression

__all__ = ("update",)


def update(self: Model, using: str | None = None, **kwargs: Any) -> int:
    """
    Updates specified attributes on the current instance.
    """
    assert self.pk, "Cannot update an instance that has not yet been created."

    using = using or router.db_for_write(self.__class__, instance=self)

    for field in self._meta.fields:
        if getattr(field, "auto_now", False) and field.name not in kwargs:
            kwargs[field.name] = field.pre_save(self, False)

    affected = cast(
        int, self.__class__._base_manager.using(using).filter(pk=self.pk).update(**kwargs)
    )
    for k, v in kwargs.items():
        if isinstance(v, CombinedExpression):
            v = resolve_combined_expression(self, v)
        setattr(self, k, v)
    if affected == 1:
        post_save.send(sender=self.__class__, instance=self, created=False)
        return affected
    elif affected == 0:
        return affected
    elif affected < 0:
        raise ValueError(
            "Somehow we have updated a negative number of rows. You seem to have a problem with your db backend."
        )
    else:
        raise ValueError("Somehow we have updated multiple rows. This is very, very bad.")


update.alters_data = True  # type: ignore


def in_iexact(column: str, values: Any) -> Q:
    """Operator to test if any of the given values are (case-insensitive)
    matching to values in the given column."""
    from operator import or_

    query = f"{column}__iexact"

    return reduce(or_, [Q(**{query: v}) for v in values])


def in_icontains(column: str, values: Any) -> Q:
    """Operator to test if any of the given values are (case-insensitively)
    contained within values in the given column."""
    from operator import or_

    query = f"{column}__icontains"

    return reduce(or_, [Q(**{query: v}) for v in values])
