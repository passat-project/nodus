-- «Результат выдан» (#635, §11): отметка статуса маршрута — с него результат
-- работы считается выданным. Expand-only: аддитивная колонка с DEFAULT false.
ALTER TABLE "workflow_stages" ADD COLUMN "result_issued" BOOLEAN NOT NULL DEFAULT false;
