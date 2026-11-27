# -*- coding: utf-8 -*-
"""Instructivo: Canje (grano) - cuenta corriente flexible en kg de soja."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Cuenta-Canje-en-Grano.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#1f2937"), leading=13)
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9.5, textColor=G900, leading=13)
st_cellr = S("cellr", fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#1f2937"), leading=13, alignment=2)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Canje (grano): cuenta corriente flexible", st_title))
    E.append(Paragraph("Una sola pantalla para llevarle a cada cliente el canje como cuenta corriente en kilos de soja", st_sub))
    E.append(Paragraph(
        "<b>Plan canje</b> y <b>Cuenta canje</b> se <b>unificaron</b> en una sola pantalla flexible llamada "
        "<b>Canje (grano)</b> (menú <b>Fábrica</b>). Es una cuenta corriente con cada cliente o proveedor, "
        "medida en <b>kilos de soja</b>: cargás el acuerdo pero <b>no es estricto</b>, vas registrando los "
        "movimientos a medida que pasan y el saldo se ajusta solo.", st_intro))

    # --- Que es ---
    E.append(Paragraph("¿Qué es?", st_h2))
    E.append(Paragraph(
        "Una sola pantalla donde llevás el canje con cada cliente o proveedor como <b>cuenta corriente en "
        "kilos de soja</b>. Cargás el acuerdo, pero <b>no es estricto</b>: registrás los movimientos a medida "
        "que pasan y el saldo refleja siempre cómo estás parado con esa persona.", st_intro))
    E.append(callout("Está en el menú <b>Fábrica &rarr; &#128210; Canje (grano)</b>. Es la misma pantalla para todo: "
                     "ya no hay que elegir entre &ldquo;Plan canje&rdquo; y &ldquo;Cuenta canje&rdquo;, ahora es una sola.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # --- Movimientos ---
    E.append(Paragraph("Movimientos", st_h2))
    E.append(Paragraph("La cuenta se arma con los movimientos que vas cargando (hay un botón para cada uno):", st_intro))
    E.append(bullets([
        "<b>&#127782; Entró grano del cliente:</b> deja soja &rarr; le queda saldo <b>a favor</b> (+kg). "
        "Si elegís un <b>depósito</b>, el grano entra al stock.",
        "<b>&#128230; Se llevó producto:</b> cada retiro descuenta su equivalente en grano según la <b>paridad</b> "
        "que ponés en el momento (ej. 1 kg de expeller = 1,2 kg de soja). Si elegís un <b>depósito</b>, el producto "
        "sale del stock.",
        "<b>&#128181; Liquidar en pesos (NUEVO):</b> cuando en vez de llevarse producto te dice &ldquo;liquidame tantos "
        "kilos y pagámelos&rdquo;. Ponés los <b>kilos</b> y el <b>precio</b> ($/kg; viene de la <b>pizarra de soja del "
        "día</b>, editable). Baja el saldo en kg y <b>genera la deuda a pagar</b> (va a <b>Cuentas a pagar</b>). Si borrás "
        "el movimiento, se borra la deuda.",
        "<b>&#9999;&#65039; Ajuste manual:</b> sumás o restás kg de soja a mano.",
    ]))
    E.append(callout("<b>La paridad es la clave.</b> Ejemplo: si acordaste que <b>1 kg de expeller = 1,2 kg de soja</b>, "
                     "en &ldquo;Se llevó producto&rdquo; pones <b>1,2</b>. Si retira 1.000 kg de expeller, le descuenta "
                     "<b>1.200 kg de soja</b> del saldo. El sistema te muestra ese cálculo antes de guardar.",
                     G100, G600, G900))

    # --- Saldo ---
    E.append(Paragraph("El saldo", st_h2))
    E.append(Paragraph(
        "El saldo va siempre en <b>kg de soja</b> (y te muestra su valor en $ según la pizarra del día). "
        "Así lo leés:", st_intro))
    E.append(bullets([
        "<b>Saldo con +</b> (ej. +1.200 kg) &rarr; <b>le falta llevar / le debés</b>: dejó más grano del que retiró o liquidó.",
        "<b>Saldo con -</b> (ej. -300 kg) &rarr; <b>se pasó / te debe</b>: retiró o liquidó más de lo que dejó.",
        "<b>En cero</b> &rarr; <b>al día</b>: no debe ni le deben.",
    ]))

    # --- Operacion completa ---
    E.append(Paragraph("Operación completa", st_h2))
    E.append(Paragraph(
        "Si una operación <b>entra y sale junta</b> con un acuerdo fijo (ej. entrego expeller y recibo soja de una), "
        "no necesitás cargar los movimientos uno por uno: dentro de la misma pantalla está el botón "
        "<b>&#128257; Operación completa</b>. La cargás ahí y volvés con un botón.", st_intro))

    # --- Ejemplo ---
    E.append(Paragraph("Ejemplo", st_h2))
    ej = [
        [Paragraph("Movimiento", st_cellb), Paragraph("Qué cargás", st_cellb), Paragraph("Saldo del cliente", st_cellb)],
        [Paragraph("Entró grano", st_cell), Paragraph("Deja 10.000 kg de soja", st_cell), Paragraph("+10.000 kg (a favor)", st_cellr)],
        [Paragraph("Se llevó producto", st_cell), Paragraph("Retira 5.000 kg expeller, paridad 1,2", st_cell), Paragraph("+4.000 kg", st_cellr)],
        [Paragraph("Liquidar en pesos", st_cell), Paragraph("Liquida 3.600 kg a $400/kg", st_cell), Paragraph("+400 kg", st_cellr)],
        [Paragraph("Estado hoy", st_cellb), Paragraph("Le falta llevar / le debés", st_cellb), Paragraph("+400 kg soja", st_cellr)],
    ]
    te = Table(ej, colWidths=[36*mm, 85*mm, 44*mm])
    te.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100), ("BACKGROUND",(0,-1),(-1,-1),colors.HexColor("#f0fdf4")),
        ("BOX",(0,0),(-1,-1),0.6,G600), ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("LINEABOVE",(0,-1),(-1,-1),1.0,G600),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(0,0),(-1,-1),6), ("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(te)
    E.append(Spacer(1, 2))
    E.append(Paragraph("La liquidación de 3.600 kg a $400/kg baja el saldo a +400 kg y genera una deuda de "
                       "$1.440.000 en Cuentas a pagar.", st_sub))

    # --- Stock ---
    E.append(Paragraph("¿Mueve el stock?", st_h2))
    E.append(bullets([
        "Si en &ldquo;Entró grano&rdquo; o &ldquo;Se llevó producto&rdquo; elegís un <b>depósito</b>, AgroCore además "
        "<b>mueve el stock</b> solo: el grano ENTRA y el producto SALE del depósito. No tenés que cargar aparte el movimiento de stock.",
        "Si <b>dejás el depósito vacío</b>, solo lleva la cuenta del canje sin tocar el stock (útil si el stock lo controlás por otro lado).",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Dónde veo lo que le tengo que pagar tras liquidar?",
         "En Cuentas a pagar (y también en la Ficha del contacto). Cuando liquidás en pesos, la deuda se genera sola; si borrás el movimiento, la deuda se borra."),
        ("¿Puedo retirar más o menos de lo acordado?",
         "Sí, es flexible: cada movimiento ajusta el saldo. Cargás el acuerdo como referencia, pero registrás lo que realmente va pasando."),
        ("¿Por qué el saldo está en kg de soja y no en producto?",
         "Porque el grano es la 'moneda' del canje. Cada retiro de producto se convierte a su equivalente en soja con la paridad que cargás, así todo queda en la misma unidad."),
        ("¿Qué paridad pongo cuando se lleva producto?",
         "Cuántos kg de soja vale 1 kg del producto que se lleva. Si 1 kg de expeller = 1,2 kg de soja, pones 1,2. Es el acuerdo que tengas con el cliente, y lo ponés en el momento de cada retiro."),
        ("¿De dónde sale el precio cuando liquido en pesos?",
         "De la pizarra de soja del día, y lo podés editar antes de guardar. Con ese precio por kg se arma la deuda a pagar."),
        ("Me equivoqué en un movimiento. ¿Lo puedo borrar?",
         "Sí. Entrá al detalle del cliente y borrá la línea (si tenés permiso). El saldo se recalcula solo, y si era una liquidación también se borra la deuda."),
        ("¿Sirve para proveedores también?",
         "Sí. En el desplegable de contacto podés elegir clientes o proveedores."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
