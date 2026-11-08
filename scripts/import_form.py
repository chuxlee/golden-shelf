#!/usr/bin/env python3
"""Import Yandex Forms JSON into the golden-shelf Jekyll collections (Python 3.10+)."""
import argparse
import json
import re
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).lower().replace('ё', 'е').split())


def field(row, prefix):
    matches = [v for k, v in row.items() if normalize(k).startswith(normalize(prefix))]
    if len(matches) > 1:
        raise ValueError(f'Неоднозначное поле: {prefix}')
    return str(matches[0] or '').strip() if matches else ''


def numbered(text):
    """Preserve multiline entries and match by explicit item number."""
    matches = list(re.finditer(r'^\s*(\d+)[.)]\s+', text, re.M))
    if not matches:
        return {1: text.strip()} if text.strip() else {}
    if text[:matches[0].start()].strip():
        raise ValueError('Обнаружен текст перед нумерованным списком')
    result = {}
    for index, match in enumerate(matches):
        number = int(match[1])
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        if number in result:
            raise ValueError(f'Повтор номера {number} в списке')
        result[number] = text[match.end():end].strip()
    return result


def urls(text):
    return re.findall(r'https?://[^\s,]+', text)


def attachment_name(url):
    parsed = urllib.parse.urlparse(url)
    path = urllib.parse.parse_qs(parsed.query).get('path', [parsed.path])[0]
    name = Path(path).name
    return re.sub(r'^[0-9a-f]{16,}_', '', name, flags=re.I)


def docx_text(path):
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo('word/document.xml')
        if info.file_size > 20_000_000:
            raise ValueError('Слишком большой DOCX')
        root = ET.fromstring(archive.read(info))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    return '\n'.join(''.join(p.itertext()).strip() for p in root.findall('.//w:body/w:p', ns) if ''.join(p.itertext()).strip())


def frontmatter(data, body):
    # JSON strings, arrays and objects are valid YAML values.
    lines = [f'{key}: {json.dumps(value, ensure_ascii=False)}' for key, value in data.items()]
    return '---\n' + '\n'.join(lines) + '\n---\n\n' + body.strip() + '\n'


def acquire(url, local_dir, cache, download):
    name = attachment_name(url)
    if local_dir:
        matches = [p for p in local_dir.iterdir() if p.is_file() and (p.name == name or p.name.endswith('_' + name))]
        if len(matches) > 1:
            raise ValueError(f'Несколько вложений с именем {name}')
        if matches:
            return matches[0]
    if not download:
        raise ValueError(f'Не найдено вложение {name}. Сохраните его в --attachments или укажите --download')
    destination = cache / str(len(list(cache.iterdir())))
    request = urllib.request.Request(url, headers={'User-Agent': 'golden-shelf-import/1.0'})
    with urllib.request.urlopen(request, timeout=40) as response:
        if 'text/html' in response.headers.get('Content-Type', ''):
            raise ValueError(f'Вместо {name} получена HTML-страница. Скачайте вложение вручную')
        with destination.open('wb') as output:
            total = 0
            while chunk := response.read(65536):
                total += len(chunk)
                if total > 50_000_000:
                    raise ValueError(f'Вложение {name} превышает 50 МБ')
                output.write(chunk)
    return destination


def build(row, args, cache, plan, warnings):
    author = field(row, 'Фамилия преподавателя латинскими буквами')
    if not re.fullmatch(r'[a-z][a-z0-9_-]*', author):
        raise ValueError(f'Недопустимый author_id: {author!r}')
    name = field(row, 'ФИО преподавателя')
    if not name:
        raise ValueError(f'{author}: отсутствует ФИО')
    person = dict(layout='person', title=name, name=name, author_id=author,
                  bio_short=field(row, 'Краткая биография'))
    for key, label in [('degree', 'Ученая степень'), ('academic_title', 'Ученое звание'), ('science_field', 'Отрасль наук')]:
        value = field(row, label)
        if value:
            person[key] = value
    if author in args.rector or normalize(field(row, 'Ректор КГИК')) in {'да', 'true', '1'}:
        person['is_rector'] = True
    titles = numbered(field(row, 'Названия книг'))
    descriptions = numbered(field(row, 'Библиографическое описание книг'))
    annotations = numbered(field(row, 'Анотации к книгам') or field(row, 'Аннотации к книгам'))
    for label, items in [('описания', descriptions), ('аннотации', annotations)]:
        if set(items) - set(titles):
            raise ValueError(f'{author}: {label} содержат номера без названий книг')
        if set(titles) - set(items):
            warnings.append(f'{author}: отсутствуют {label} для книг {sorted(set(titles) - set(items))}')
    base = Path('assets/images/persons') / author
    covers = {}
    media = []

    def add(path, content):
        if path in plan:
            raise ValueError(f'Повтор выходного файла: {path}')
        plan[path] = content

    attachment_urls = urls(field(row, 'Портрет, картинки'))
    for index, url in enumerate(attachment_urls, 1):
        original = attachment_name(url)
        stem, extension = Path(original).stem.lower(), Path(original).suffix.lower()
        book = re.fullmatch(r'book(\d+)(?:-cover)?', stem)
        if extension not in {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.pdf'}:
            warnings.append(f'{author}: вложение {original} не импортировано, формат требует ручной обработки')
            continue
        if stem == 'portrait':
            target = base / ('portrait' + extension)
            person['photo'] = '/' + target.as_posix()
        elif book:
            number = int(book[1])
            if number not in titles or number in covers:
                raise ValueError(f'{author}: обложка {original} не соответствует уникальной книге')
            target = base / (f'book{number}' + extension)
            covers[number] = '/' + target.as_posix()
        else:
            target = base / (f'media{index}' + extension)
            kind = {'.mp3': 'audio', '.pdf': 'pdf'}.get(extension, 'image')
            media.append(dict(type=kind, url='/' + target.as_posix(), label=original))
        add(target, acquire(url, args.attachments, cache, args.download).read_bytes())
    bibliography = field(row, 'Библиографический список')
    if urls(bibliography):
        entries = []
        for url in urls(bibliography):
            if Path(attachment_name(url)).suffix.lower() != '.docx':
                raise ValueError('Библиография по ссылке должна быть DOCX')
            text = docx_text(acquire(url, args.attachments, cache, args.download))
            entries.extend(numbered(text).values() if re.search(r'^\s*\d+[.)]\s+', text, re.M) else text.splitlines())
        person['bibliography'] = entries
    else:
        person['bibliography'] = list(numbered(bibliography).values())
    person['media'] = media
    biography = field(row, 'Биография, образование')
    extra = field(row, 'Прикрепите файл, если текст')
    extra_annotations = field(row, 'Если аннотации не помещаются')
    if extra or extra_annotations:
        raise ValueError(f'{author}: биография/аннотации прикреплены отдельным файлом. Перенесите текст в соответствующие поля JSON')
    notes = field(row, 'Поле для ввода описания картинок')
    if notes:
        warnings.append(f'{author}: подписи медиа сохранены в media_notes, распределите их по media[].label')
        person['media_notes'] = notes
    add(Path('_persons') / f'{author}.md', frontmatter(person, biography).encode())
    for number, title in titles.items():
        work = dict(layout='work', title=title, author_id=author)
        if number in covers:
            work['cover'] = covers[number]
        body = '## Библиографическое описание\n\n' + descriptions.get(number, '') + '\n\n## Аннотация\n\n' + annotations.get(number, '')
        add(Path('_works') / f'{author}{number}.md', frontmatter(work, body).encode())
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('json_file', type=Path)
    parser.add_argument('--site', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--attachments', type=Path, help='Папка со скачанными вложениями')
    parser.add_argument('--rector', action='append', default=[], metavar='AUTHOR_ID', help='ID ректора, например --rector turavets (можно повторять)')
    parser.add_argument('--download', action='store_true', help='Скачивать недостающие вложения по ссылкам')
    parser.add_argument('--dry-run', action='store_true', help='Проверить импорт без записи')
    args = parser.parse_args()
    args.site = args.site.resolve()
    if not (args.site / '_config.yml').is_file():
        parser.error('--site должен указывать на корень сайта Jekyll')
    if args.attachments and not args.attachments.is_dir():
        parser.error('--attachments должен указывать на существующую папку')
    plan, warnings, folders = {}, [], []
    try:
        data = json.loads(args.json_file.read_text(encoding='utf-8-sig'))
        if not isinstance(data, list) or not data:
            raise ValueError('Ожидается непустой массив ответов')
        with tempfile.TemporaryDirectory() as temporary:
            for raw in data:
                if not isinstance(raw, list) or any(not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(v, str) for v in pair) for pair in raw):
                    raise ValueError('Ответ должен быть массивом пар [название поля, текст]')
                if len(dict(raw)) != len(raw):
                    raise ValueError('В ответе повторяются названия полей')
                folders.append(build(dict(raw), args, Path(temporary), plan, warnings))
        changes = {}
        for path, content in plan.items():
            destination = args.site / path
            if not destination.resolve().is_relative_to(args.site):
                raise ValueError(f'Путь выходит за пределы сайта: {path}')
            if destination.exists():
                if destination.read_bytes() != content:
                    raise ValueError(f'Файл уже существует и отличается: {path}. Импорт остановлен, проверьте изменения вручную')
            else:
                changes[path] = content
        for warning in warnings:
            print('ВНИМАНИЕ:', warning, file=sys.stderr)
        for path in changes:
            print(('Будет создан: ' if args.dry_run else 'Создание: ') + str(path))
        if args.dry_run:
            print(f'Проверка завершена. Новых файлов: {len(changes)}')
            return
        created = []
        try:
            for folder in folders:
                (args.site / folder).mkdir(parents=True, exist_ok=True)
            for path, content in changes.items():
                destination = args.site / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open('xb') as output:
                    created.append(destination)
                    output.write(content)
        except Exception:
            for path in reversed(created):
                path.unlink()
            raise
        print(f'Готово. Создано файлов: {len(changes)}. Совпадающих файлов: {len(plan) - len(changes)}')
    except (ValueError, OSError, zipfile.BadZipFile, KeyError, ET.ParseError) as error:
        parser.exit(1, f'Ошибка: {error}\n')


if __name__ == '__main__':
    main()
