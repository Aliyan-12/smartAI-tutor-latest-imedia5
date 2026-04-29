from sqlalchemy import Column, Integer, String, JSON, DateTime, ForeignKey, func

from app.db.session import Base


class SessionSlide(Base):
    __tablename__ = "session_slides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    appointment_id = Column(
        Integer,
        ForeignKey("appointments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slide_order = Column(Integer, nullable=False, default=0)
    title = Column(String(200), nullable=False)
    emoji = Column(String(10), nullable=False, default="📄")
    bullets = Column(JSON, nullable=False, default=list)
    key_terms = Column(JSON, nullable=False, default=list)
    highlight = Column(String(500), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
