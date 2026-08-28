# -*- coding: utf-8 -*-
"""Genera los instructivos de Haras/Caballos y Circuito de Rodeos (estilo AgroCore).
Incluye lo nuevo: fichas que suman al stock, prestar/devolver, terceros diferenciados,
foto del animal y catálogo de equinos. Genera 2 PDFs."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=26)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600,
        leftIndent=16, bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def _hf(titulo):
    def header_footer(canvas, doc):
        canvas.saveState(); w, h = A4
        canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
        try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
        except Exception: pass
        canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13)
        canvas.drawString(34*mm, h-15*mm, "AgroCore")
        canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, titulo)
        canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
        canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
        canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
        canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
        canvas.restoreState()
    return header_footer

def _doc(path, titulo):
    doc = BaseDocTemplate(path, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=_hf(titulo))])
    return doc

# ============================================================ HARAS / CABALLOS
def build_haras():
    OUT = os.path.join(INSTR, "Instructivo-Haras-Caballos.pdf")
    doc = _doc(OUT, "Haras / Caballos")
    E = []
    E.append(Paragraph("Fichas de animales (Haras / Caballos)", st_title))
    E.append(Paragraph("Ficha individual, foto, stock por tipo, prestamos y venta", st_sub))
    E.append(Paragraph(
        "Cada caballo (o cualquier animal individual) se carga como una <b>Ficha</b> con su identidad, "
        "genealogia, sanidad, costos y venta. Ademas, cada ficha <b>suma 1 cabeza al Stock general</b> "
        "agrupada por <b>Animal &rarr; Equino &rarr; categoria</b> (Padrillo, Yegua madre, Potrillo, etc.).", st_intro))
    E.append(callout("<b>Novedad:</b> ahora las fichas aparecen en <b>Stock</b> y sus altas, ventas, prestamos "
                     "y devoluciones quedan como <b>movimientos de stock</b>. Los <b>vendidos</b>, <b>prestados</b> "
                     "y de <b>baja</b> NO cuentan en el stock del campo.", G100, G600, G900))

    E.append(Paragraph("1) Cargar una ficha", st_h2))
    E.append(steps([
        "Entra a <b>Fichas de animales</b> y toca <b>+ Nuevo animal</b>.",
        "Completa <b>Nombre</b>, <b>Especie</b> (Equino) y la <b>Categoria</b> (elegila del desplegable: Padrillo, Yegua madre, Potrillo...).",
        "Cargas identificacion (microchip, RFID, N&deg; registro), genealogia (padre/madre) y datos economicos (costo de alta, moneda).",
        "<b>Foto:</b> arriba del formulario, toca <b>Seleccionar archivo</b> y elegi la imagen; se reduce sola. Tambien podes cargarla despues con el boton <b>Agregar/Cambiar foto</b> dentro de la ficha.",
        "Guarda. La ficha suma <b>1 cabeza</b> al Stock (Equino &middot; su categoria).",
    ]))

    E.append(Paragraph("2) El catalogo de equinos", st_h2))
    E.append(Paragraph("En <b>Catalogos &rarr; Animales</b> ya vienen cargadas todas las categorias de equinos "
        "(Padrillo, Yegua madre, Yegua, Potrillo, Potranca, Caballo de polo, etc.). Se usan en la ficha y para "
        "agrupar el stock. Podes agregar mas categorias si las necesitas.", st_intro))

    E.append(Paragraph("3) Prestar y devolver un caballo", st_h2))
    E.append(Paragraph("Cuando un caballo sale del campo de forma provisoria (por ejemplo se va a jugar), "
        "usa <b>Prestar</b>: sale del stock del campo pero <b>puede volver</b>.", st_intro))
    E.append(steps([
        "Abri la ficha del caballo y toca <b>Prestar</b>.",
        "Indica <b>a quien / donde</b>, la fecha y (opcional) la <b>fecha estimada de vuelta</b> (agenda un recordatorio).",
        "El caballo queda en estado <b>Prestado</b> y <b>deja de sumar</b> al stock del campo.",
        "Cuando vuelve, abri la ficha y toca <b>Devolver</b>: se reintegra al stock.",
    ]))

    E.append(Paragraph("4) Vender un caballo", st_h2))
    E.append(steps([
        "Abri la ficha y toca <b>Vender</b>: cargas precio, moneda y referencia.",
        "Queda en estado <b>Vendido</b> (no suma al campo) y se guarda a quien se vendio; lo podes <b>filtrar por estado Vendido</b>.",
    ]))

    E.append(Paragraph("5) Caballos de terceros (pension / hoteleria)", st_h2))
    E.append(Paragraph("Si recibis caballos de un tercero, marca la ficha como <b>externo</b> con su <b>propietario</b>. "
        "Se contabilizan en el stock pero en un <b>renglon aparte</b> (\"Equino &middot; categoria <b>(terceros)</b>\"), "
        "separado de los propios. Para cobrar la pension usa los eventos <b>Pension</b> o el resumen de "
        "<b>Hoteleria (terceros)</b>.", st_intro))
    E.append(callout("<b>Tip:</b> en <b>Stock</b>, filtra por <b>Familia = Equino</b> para ver el total por categoria; "
                     "los de terceros aparecen con la etiqueta <b>(terceros)</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    for q,a in [
        ("&#191;Por que un caballo no figura en el stock del campo?",
         "Porque esta <b>Vendido</b>, <b>Prestado</b> o de <b>Baja</b>. Esos no cuentan como stock propio en el campo."),
        ("&#191;Los de terceros suman a mi stock?",
         "Se muestran para que los controles, pero en un renglon <b>(terceros)</b> separado; no se mezclan con los propios."),
        ("&#191;Puedo ver como se movio el stock?",
         "Si, en <b>Movimientos</b> vas a ver el alta, la venta, el prestamo y la devolucion de cada ficha."),
    ]:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E); print("PDF generado:", OUT)

# ============================================================ CIRCUITO RODEOS
def build_rodeos():
    OUT = os.path.join(INSTR, "Instructivo-Circuito-Rodeos.pdf")
    doc = _doc(OUT, "Circuito de Rodeos")
    E = []
    E.append(Paragraph("Circuito de Rodeos (Costo de hacienda)", st_title))
    E.append(Paragraph("Lotes de engorde/cria, costo por kg, capitalizacion de terceros", st_sub))
    E.append(Paragraph(
        "Un <b>Rodeo</b> es un lote de hacienda (engorde o cria) que agrupa cabezas para medir su "
        "<b>costo por kilo producido</b>. Podes vincular <b>Fichas de animales</b> con caravana/collar a un lote "
        "para sumar su peso individual al pesaje del lote.", st_intro))

    E.append(Paragraph("1) Crear un lote (rodeo)", st_h2))
    E.append(steps([
        "Entra a <b>Costo de hacienda</b> y toca <b>+ Lote</b>.",
        "Completa nombre, <b>sistema</b> (Feedlot, Pastoril...), <b>categoria</b>, cabezas y kg iniciales.",
        "Guarda. El lote queda <b>Activo</b> y empieza a acumular costos.",
    ]))

    E.append(Paragraph("2) Cargar costos y consumos", st_h2))
    E.append(steps([
        "En el lote, carga los <b>eventos</b>: alimentacion (consumo de galpon/silo), sanidad, labores, etc.",
        "El sistema calcula el <b>costo acumulado</b> y el <b>$/kg producido</b> (costos &divide; kilos ganados).",
        "Con caravana/collar, usa <b>Pesaje desde balanzas</b> para armar el pesaje del lote sumando el peso de las fichas vinculadas.",
    ]))

    E.append(Paragraph("3) Hacienda de terceros (capitalizacion / hoteleria)", st_h2))
    E.append(Paragraph("Si recibis hacienda de un tercero para engordar y cobrar el servicio, en el lote marca "
        "<b>Hacienda de terceros</b> y cargas el <b>propietario</b>.", st_intro))
    E.append(steps([
        "Al editar el lote, tilda <b>\"Hacienda de terceros (capitalizacion / hoteleria de engorde)\"</b> y escribi el <b>propietario</b>.",
        "Carga los cargos con el tipo <b>Capitalizacion / Pension</b> marcando <b>\"Cobrar al propietario\"</b>.",
        "Con <b>Hoteleria / capitalizacion (terceros)</b> sacas un <b>resumen por propietario</b> (cabezas + total a cobrar), listo para facturar.",
    ]))
    E.append(callout("<b>Importante:</b> la hacienda de terceros se maneja <b>separada</b> de la propia: se controla y "
                     "se cobra, pero no se mezcla con tu stock propio.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("4) Relacion con Fichas y Stock", st_h2))
    E.append(Paragraph("Las <b>Fichas de animales</b> individuales (con caravana) pueden vincularse a un lote desde el "
        "campo <b>Lote / rodeo</b> de la ficha. Asi el peso individual suma al lote, y a la vez cada ficha cuenta como "
        "1 cabeza en el <b>Stock general</b> por su categoria.", st_intro))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    for q,a in [
        ("&#191;El costo/kg incluye la compra de los animales?",
         "Incluye el costo de alta/compra cargado + todos los eventos de costo del lote, dividido por los kilos producidos."),
        ("&#191;Como diferencio lo propio de lo de terceros?",
         "El lote marcado como <b>terceros</b> muestra su propietario y se totaliza aparte en el resumen de hoteleria/capitalizacion."),
    ]:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E); print("PDF generado:", OUT)

if __name__ == "__main__":
    build_haras()
    build_rodeos()
