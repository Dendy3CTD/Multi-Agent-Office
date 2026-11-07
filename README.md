# Классификация сельскохозяйственных культур

Нейросеть на основе EfficientNet-B0 для распознавания 30 видов культур по фотографии.

## Культуры
wheat, rice, soyabean, sunflower, cotton, sugarcane, tomato, чили и другие (30 классов).

## Установка
```bash
pip install -r requirements.txt
```

## Обучение
```bash
python3 train.py --data ./data/Agricultural-crops --epochs 20 --pretrained
```

## Предсказание по фото
```bash
python3 predict.py --image фото.jpg --weights ./weights/best_model.pth
```

## Архитектура
- Модель: EfficientNet-B0 (предобученная на ImageNet)
- Датасет: Agricultural Crops Image Classification (Kaggle, 574 фото, 30 классов)
- Метрика: Accuracy на валидации

## Результаты обучения
Смотри weights/best_model.pth — сохраняется лучшая эпоха по val accuracy.
