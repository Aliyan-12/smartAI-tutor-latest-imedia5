from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class AssessmentStart(BaseModel):
    chat_session_id: Optional[str] = None
    subject: str
    key_stage: str
    topic: str


class AnswerSubmit(BaseModel):
    question_index: int = Field(..., ge=0, le=9)
    student_answer: int = Field(..., ge=0, le=3)


class AssessmentQuestionResponse(BaseModel):
    id: int
    question_index: int
    question_text: str
    options: list
    correct_answer: Optional[int] = None
    student_answer: Optional[int] = None
    is_correct: Optional[bool] = None
    explanation: Optional[str] = None
    topic_tag: str

    model_config = {"from_attributes": True}


class AssessmentResponse(BaseModel):
    id: int
    student_id: int
    chat_session_id: Optional[str] = None
    appointment_id: Optional[int] = None
    assessment_type: Optional[str] = None
    subject: str
    key_stage: str
    topic: str
    total_questions: int
    correct_answers: int
    score_percent: float
    weak_topics: Optional[list] = None
    strong_topics: Optional[list] = None
    report_text: Optional[str] = None
    status: str
    created_at: datetime
    questions: List[AssessmentQuestionResponse] = []

    model_config = {"from_attributes": True}


class StudentProgressResponse(BaseModel):
    student_id: int
    student_name: str
    total_assessments: int
    average_score: Optional[float] = None
    latest_score: Optional[float] = None
    weak_topics: List[str] = []
    strong_topics: List[str] = []
    assessments: List[AssessmentResponse] = []
