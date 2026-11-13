# -*- coding: utf-8 -*-
"""Instructivo: Cuenta canje en grano (dónde cargarlo y cómo ver el resumen)."""
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
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Cuenta canje en grano", st_title))
    E.append(Paragraph("Llevar la cuenta de cada cliente: lo que entrego de grano, lo que se lleva en producto y lo que falta", st_sub))
    E.append(Paragraph(
        "El <b>canje</b> es: el cliente te deja <b>grano (soja)</b> y se lleva <b>producto</b> "
        "(expeller, aceite, balanceado...), o al reves. AgroCore tiene <b>dos formas</b> de registrarlo y "
        "lo mas importante es <b>elegir UNA sola</b> segun como opera cada cliente. Si cargas la misma "
        "operacion en las dos, el saldo se <b>duplica</b>.", st_intro))

    # --- Dos formas: elegir una ---
    E.append(Paragraph("Primero: elegi UNA de las dos formas", st_h2))
    comp = [
        [Paragraph("Forma", st_cellb), Paragraph("Cuando usarla", st_cellb), Paragraph("Que hace", st_cellb)],
        [Paragraph("&#128257; Plan canje", st_cellb),
         Paragraph("La operacion <b>entra y sale completa</b> (ej. entrego expeller y recibo soja de una), con una paridad fija.", st_cell),
         Paragraph("Una operacion cerrada. Mueve el stock en especie. No lleva cuenta corriente.", st_cell)],
        [Paragraph("&#128210; Cuenta canje (grano)", st_cellb),
         Paragraph("El cliente <b>a veces entrega y a veces saca</b>, no siempre lo mismo, y queres llevarle la <b>cuenta corriente</b>.", st_cell),
         Paragraph("Cuenta corriente en kg de soja por cliente: todos los movimientos y el saldo (le falta llevar / se paso).", st_cell)],
    ]
    tc = Table(comp, colWidths=[38*mm, 68*mm, 59*mm])
    tc.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100), ("BOX",(0,0),(-1,-1),0.6,G600), ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(0,0),(-1,-1),6), ("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(tc)
    E.append(Spacer(1, 4))
    E.append(callout("<b>&#9888; No cargues la misma operacion en las dos.</b> Si ya la registraste en <b>Plan canje</b>, "
                     "no vuelvas a cargarla en <b>Cuenta canje</b> (y al reves): se sumaria dos veces y el saldo quedaria mal. "
                     "Este instructivo explica la <b>Cuenta canje</b>, que es la que lleva el saldo por cliente.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    # --- Donde esta ---
    E.append(Paragraph("1) Donde se carga la Cuenta canje", st_h2))
    E.append(steps([
        "Menu <b>Comercial &rarr; &#128210; Cuenta canje (grano)</b>. (En las empresas de fabrica tambien se llega "
        "desde <b>Industria / Molienda</b>, pero vive en Comercial.)",
        "Esa es la pantalla donde se lleva el canje con saldo y donde ves el resumen por cliente.",
        "Al lado esta la solapa <b>&#128257; Plan canje</b>: es la OTRA forma (operacion cerrada). Usa una o la otra, no las dos.",
    ]))
    E.append(callout("Ruta corta: <b>Comercial &rarr; &#128210; Cuenta canje (grano)</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    # --- Dos pasos ---
    E.append(Paragraph("2) Se carga en dos pasos", st_h2))
    E.append(Paragraph("La cuenta se arma con dos tipos de movimiento (hay un boton para cada uno):", st_intro))
    E.append(bullets([
        "<b>&#127782; Entro grano del cliente:</b> el cliente te deja soja. Le queda <b>saldo a favor</b> "
        "(tiene credito para llevar producto). Elegis cliente, producto (grano), cantidad en kg y, si queres, "
        "el <b>deposito</b> donde entra el grano.",
        "<b>&#128230; Se llevo producto:</b> cada vez que retira expeller, aceite, etc. Aca ademas de la cantidad "
        "cargas la <b>paridad</b>: <b>cuantos kg de soja equivale 1 kg de ese producto</b> (campo "
        "&ldquo;Equivale a&rdquo;). Eso descuenta el equivalente en grano del saldo.",
        "<b>&#9999;&#65039; Ajuste manual:</b> para corregir el saldo a mano (en kg de soja, con + a favor o - en contra). "
        "Se usa poco, solo para acomodar diferencias.",
    ]))
    E.append(callout("<b>La paridad es la clave.</b> Ejemplo: si acordaste que <b>1 kg de expeller = 1,2 kg de soja</b>, "
                     "en &ldquo;Se llevo producto&rdquo; pones <b>1,2</b> en &ldquo;Equivale a&rdquo;. Si retira 1.000 kg de "
                     "expeller, le descuenta <b>1.200 kg de soja</b> del saldo. El sistema te muestra ese calculo antes de guardar.",
                     G100, G600, G900))

    # --- Resumen ---
    E.append(Paragraph("3) El resumen: que entrego, que se lleva, que falta", st_h2))
    E.append(Paragraph(
        "En la misma pantalla de <b>Cuenta canje (grano)</b>, arriba de los botones, hay una tabla con "
        "<b>una fila por cliente</b>. Esto es lo que la usuaria queria tener a la vista:", st_intro))
    data = [
        [Paragraph("Columna", st_cellb), Paragraph("Que te dice", st_cellb)],
        [Paragraph("Cliente / Proveedor", st_cell), Paragraph("Cada persona que tiene canje abierto", st_cell)],
        [Paragraph("Saldo (kg soja)", st_cell), Paragraph("Cuanto grano le queda a favor (o en contra), neto de lo que ya se llevo", st_cell)],
        [Paragraph("Estado", st_cell), Paragraph("En palabras: le falta llevar / se paso-debe / al dia", st_cell)],
        [Paragraph("Ver detalle", st_cell), Paragraph("Abre TODOS los movimientos de ese cliente: cada grano que entro y cada retiro", st_cell)],
    ]
    t = Table(data, colWidths=[46*mm, 119*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100), ("BOX",(0,0),(-1,-1),0.6,G600), ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(0,0),(-1,-1),6), ("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(t)
    E.append(Spacer(1, 4))
    E.append(Paragraph("Como leer el saldo:", st_intro))
    E.append(bullets([
        "<b>Saldo en verde con +</b> (ej. +1.200 kg) &rarr; <b>le falta llevar</b>: dejo mas grano del que retiro, "
        "tiene credito a favor.",
        "<b>Saldo en rojo con -</b> (ej. -300 kg) &rarr; <b>se paso / debe</b>: retiro mas de lo que dejo.",
        "<b>En cero</b> &rarr; <b>al dia</b>: no debe ni le deben.",
    ]))
    E.append(callout("Para ver el movimiento por movimiento de un cliente (cada entrada de grano y cada retiro, con fecha "
                     "y cantidad), toca <b>Ver detalle</b> en su fila. Ahi tambien podes borrar un movimiento si te equivocaste.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # --- Ejemplo ---
    E.append(Paragraph("Ejemplo completo", st_h2))
    ej = [
        [Paragraph("Movimiento", st_cellb), Paragraph("Que cargo", st_cellb), Paragraph("Saldo del cliente", st_cellb)],
        [Paragraph("Entro grano", st_cell), Paragraph("Deja 10.000 kg de soja", st_cell), Paragraph("+10.000 kg (a favor)", st_cellr)],
        [Paragraph("Se llevo producto", st_cell), Paragraph("Retira 5.000 kg expeller, paridad 1,2", st_cell), Paragraph("+4.000 kg", st_cellr)],
        [Paragraph("Se llevo producto", st_cell), Paragraph("Retira 3.000 kg expeller, paridad 1,2", st_cell), Paragraph("+400 kg", st_cellr)],
        [Paragraph("Estado hoy", st_cellb), Paragraph("Le falta llevar", st_cellb), Paragraph("+400 kg soja", st_cellr)],
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
    E.append(Paragraph("Calculo del 2do retiro: 3.000 kg x 1,2 = 3.600 kg de soja. 4.000 - 3.600 = 400 kg a favor.", st_sub))

    # --- Stock ---
    E.append(Paragraph("¿Mueve el stock?", st_h2))
    E.append(bullets([
        "Si en &ldquo;Entro grano&rdquo; o &ldquo;Se llevo producto&rdquo; elegis un <b>deposito</b>, AgroCore ademas "
        "<b>mueve el stock</b> solo: el grano ENTRA y el producto SALE del deposito. No tenes que cargar aparte el movimiento de stock.",
        "Si <b>dejas el deposito vacio</b>, solo lleva la cuenta del canje sin tocar el stock (util si el stock lo controlas por otro lado).",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Cargue la operacion en Plan canje y tambien en Cuenta canje. ¿Esta mal?",
         "Si, hay que elegir UNA sola. Son dos formas distintas de registrar lo mismo: si cargas en las dos, el saldo se duplica. Borra la que sobre y deja solo una (Plan canje para operaciones cerradas, Cuenta canje para la cuenta corriente)."),
        ("¿Donde veo lo que entrego, lo que se lleva y lo que falta?",
         "En la tabla de la solapa 'Cuenta canje (grano)': columna Saldo (kg soja) y Estado. Con 'Ver detalle' ves cada movimiento del cliente."),
        ("¿Por que el saldo esta en kg de soja y no en producto?",
         "Porque el grano es la 'moneda' del canje. Cada retiro de producto se convierte a su equivalente en soja con la paridad que cargas, asi todo queda en la misma unidad."),
        ("¿Que pongo en 'Equivale a'?",
         "Cuantos kg de soja vale 1 kg del producto que se lleva. Si 1 kg de expeller = 1,2 kg de soja, pones 1,2. Es el acuerdo que tengas con el cliente."),
        ("Me equivoque en un movimiento. ¿Lo puedo borrar?",
         "Si. Entra a 'Ver detalle' del cliente y borra la linea (si tenes permiso). El saldo se recalcula solo."),
        ("¿Sirve para proveedores tambien?",
         "Si. En el desplegable de contacto podes elegir clientes o proveedores."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
